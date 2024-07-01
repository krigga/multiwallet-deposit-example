import { BlockSubscriptionIndex } from './BlockSubscriptionIndex.js';
import TonWeb from 'tonweb';
import { confirmCollection, createJettonDeposit, createTonDeposit, getCollectionInfo, getJettonIdByJettonWallet, getLastProcessedMcBlock, getTonCollectionIdForUser, getTonCollectionUser, getUserAndJettonIdByJettonWallet, getUserIdByWallet, getUserJettonDepositsAndConfirm, getUserSeqno, getUserWallet, setLastProcessedMcBlock, setTopupRequestProcessedAndSent, updateLastKnownHotWalletTxUtime } from './db.js';
import { COLD_WALLET_ADDRESS, COLLECTION_OPCODE } from './cold-wallet.js';
import { markUserDepositsAsProcessed, onDepositProcessed } from './mark-deposits.js';
import { queryV3, tonweb } from './api.js';
import { getHotWalletAddress } from './hot-wallet.js';

const MIN_TON_DEPOSIT_VALUE = 300000000n; // 0.3 TON

const onTonDeposit = async (userId, tx) => {
    const value = BigInt(tx.in_msg.value);
    if (value < MIN_TON_DEPOSIT_VALUE) {
        return;
    }

    const collectionId = await getTonCollectionIdForUser(userId, tx.lt);

    const isAlreadyProcessed = collectionId !== undefined;

    const id = await createTonDeposit(userId, value.toString(), tx.hash, tx.lt, isAlreadyProcessed);

    if (isAlreadyProcessed) {
        await onDepositProcessed(id, value.toString());
    }
};

const onColdWalletTx = async (tx) => {
    if (Number(tx.in_msg.opcode) !== COLLECTION_OPCODE) {
        return;
    }

    const messageBody = TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(tx.in_msg.message_content.body)).beginParse();
    if (messageBody.getFreeBits() !== 32 + 64) {
        return;
    }

    messageBody.loadUint(32);

    const tonCollectionId = messageBody.loadUint(64).toString();

    const user = await getTonCollectionUser(tonCollectionId);

    if (new TonWeb.Address(tx.in_msg.source).toString(true, true, false) !== user.wallet) {
        return;
    }

    await markUserDepositsAsProcessed(user.id, tx.lt);
};

const onJettonDeposit = async (userId, jettonId, tx) => {
    const wallet = new TonWeb.token.jetton.JettonWallet(tonweb.provider, {
        address: tx.account,
    });
    const data = await wallet.getData();
    if (data.balance.isZero()) {
        return;
    }

    // assume internal_transfer

    if (tx.in_msg.opcode !== '0x178d4519') {
        return;
    }

    // todo: check for minimum deposit value etc

    await createJettonDeposit(userId, jettonId, tx.hash, tx.lt);
};

const onColdWalletJettonTx = async (jettonId, tx) => {
    if (tx.out_msgs.length === 1 && tx.out_msgs[0].destination === tx.in_msg.source) {
        // bounced
        return;
    }

    // assume internal_transfer

    if (tx.in_msg.opcode !== '0x178d4519') {
        return;
    }

    console.log('Cold wallet jetton tx');

    const messageBody = TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(tx.in_msg.message_content.body)).beginParse();
    messageBody.loadUint(32); // op already checked
    const queryId = messageBody.loadUint(64).toString();
    const amount = messageBody.loadCoins().toString();
    const sender = messageBody.loadAddress().toString(true, true, false);

    const { userId, causeDepositId, jettonFromLt } = await getCollectionInfo(queryId, jettonId);

    const wallet = await getUserWallet(userId);
    if (wallet !== sender) {
        return;
    }

    const othersIds = await getUserJettonDepositsAndConfirm(jettonId, userId, jettonFromLt, amount, causeDepositId);

    console.log('Confirming jetton deposit', causeDepositId, userId, amount);

    await onDepositProcessed(causeDepositId, amount);
    for (const other of othersIds) {
        await onDepositProcessed(other, '0');
    }
};

const onHotWalletTransaction = async (tx) => {
    if (tx.in_msg.source === null) {
        const body = TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(tx.in_msg.message_content.body)).beginParse();

        const msgInner = body.loadRef();

        msgInner.loadUint(32 + 8); // skip subwallet id and send mode

        const queryId = msgInner.loadUint(23);
        const createdAt = msgInner.loadUint(64);

        const sent = tx.out_msgs.length > 0;
        await setTopupRequestProcessedAndSent(queryId.toNumber(), createdAt.toString(), sent);
        if (!sent) {
            console.error(`WARNING! TOPUP REQUEST queryId ${queryId.toNumber()} createdAt ${createdAt.toString()} AT TX ${tx.lt}:${tx.hash} WAS NOT SENT`);
            // todo: send some system alert to a sysadmin - there is not enough balance or something like that, and manual intervention is necessary
        }

        console.log('Request query id', queryId.toNumber(), 'created at', createdAt.toString(), 'was processed and sent =', sent);
    }

    await updateLastKnownHotWalletTxUtime(tx.now);
};

const getAdjacentOutTransactions = async (hash) => {
    return (await queryV3(`/adjacentTransactions?hash=${encodeURIComponent(hash)}&direction=out&limit=128&offset=0&sort=desc`)).transactions;
};

const onUserWalletWithdrawal = async (userId, tx) => {
    const messageBody = TonWeb.boc.Cell.oneFromBoc(TonWeb.utils.base64ToBytes(tx.in_msg.message_content.body)).beginParse();
    messageBody.loadBits(512 + 32 + 32);

    const seqno = messageBody.loadUint(32).toNumber();

    const userSeqno = await getUserSeqno(userId);

    if (seqno !== userSeqno - 1) {
        console.log(`WARNING! Found user wallet tx with non-matching seqno! User ${userId}, tx seqno ${seqno}, db seqno ${userSeqno}`);
        return;
    }

    const outTxs = await getAdjacentOutTransactions(tx.hash);

    const success = outTxs.length > 0 && outTxs[0].description.compute_ph.success;

    await confirmCollection(userId, seqno, tx.lt, success);
};

const onTransaction = async (tx) => {
    // skip external messages and system messages
    if (tx.in_msg === null) {
        return;
    }

    const account = new TonWeb.Address(tx.account);
    if (account.wc !== 0) { // we only hold deposit addresses in basechain
        return;
    }

    if (tx.account.toLowerCase() === (await getHotWalletAddress()).toString(false)) {
        await onHotWalletTransaction(tx);
        return;
    }

    const unbounceableAccount = account.toString(true, true, false);
    if (unbounceableAccount === COLD_WALLET_ADDRESS && tx.in_msg.source !== null) {
        await onColdWalletTx(tx);
        return;
    }

    const userId = await getUserIdByWallet(unbounceableAccount);
    if (userId !== undefined) {
        if (tx.in_msg.source === null) {
            await onUserWalletWithdrawal(userId, tx);
        } else {
            await onTonDeposit(userId, tx);
        }
        return;
    }

    if (tx.in_msg.source === null) {
        return;
    }

    const bounceableAccount = account.toString(true, true, true);
    const juid = await getUserAndJettonIdByJettonWallet(bounceableAccount);
    if (juid !== undefined) {
        await onJettonDeposit(juid.userId, juid.jettonId, tx);
        return;
    }

    const jettonId = await getJettonIdByJettonWallet(bounceableAccount);
    if (jettonId !== undefined) {
        await onColdWalletJettonTx(jettonId, tx);
        return;
    }
};

const onBlockProcessed = async (block) => {
    console.log('Processed block', block);
    await setLastProcessedMcBlock(block);
};

export const scan = async () => {
    const subscription = new BlockSubscriptionIndex(await getLastProcessedMcBlock(), onTransaction, onBlockProcessed);
    subscription.start();
};
