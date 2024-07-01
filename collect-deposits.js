import { tonweb } from './api.js';
import { COLD_WALLET_ADDRESS, COLLECTION_OPCODE } from './cold-wallet.js';
import { createJettonCollection, createTonCollection, createTopupRequest, getEarliestUnprocessedDeposits, getEarliestUnprocessedJettonDeposit, getUnsentCollection, getUserJettonWallet, markDepositsAsProcessed } from './db.js';
import { markUserDepositsAsProcessed, markUserJettonDepositsAsProcessed } from './mark-deposits.js';
import { getWalletFromSeed, sleep } from './utils.js';
import TonWeb from 'tonweb';

const BN = TonWeb.utils.BN;

const DEPOSITS_PER_TICK = 100;
const MIN_BALANCE_TO_SEND = 30000000n; // 0.03 TON
const MIN_BALANCE_TO_SEND_JETTONS = 60000000n; // 0.06 TON
const JETTON_TRANSFER_TON_VALUE = 50000000n; // 0.05 TON

const sendTonCollection = async (seed, seqno, collectionId) => {
    const { wallet, keyPair } = getWalletFromSeed(seed);
    const payload = new TonWeb.boc.Cell();
    payload.bits.writeUint(COLLECTION_OPCODE, 32);
    payload.bits.writeUint(new TonWeb.utils.BN(collectionId), 64);
    try {
        await wallet.methods.transfers({
            secretKey: keyPair.secretKey,
            seqno,
            messages: [
                {
                    toAddress: (await wallet.getAddress()).toString(true, true, false),
                    amount: TonWeb.utils.toNano('0.01'),
                    sendMode: 1,
                },
                {
                    toAddress: COLD_WALLET_ADDRESS,
                    amount: new TonWeb.utils.BN(0),
                    sendMode: 128,
                    payload,
                },
            ],
        }).send();
    } catch (e) {
        console.error(e);
    }
};

const collectTon = async (userId, seed, fromDeposit) => {
    let collectionId, seqno;
    try {
        const r = await createTonCollection(userId, fromDeposit);
        collectionId = r.id;
        seqno = r.seqno;
    } catch (e) {
        if (e.constraint_name !== 'collections_cause_deposit_id_key') {
            console.error(e);
        }
        return;
    }

    await sendTonCollection(seed, seqno, collectionId);
};

const getJettonBalance = async (address) => {
    const data = await tonweb.provider.call(address, 'get_wallet_data');
    if (data.exit_code !== 0) {
        throw new Error(`Could not call get_wallet_data on jetton wallet ${address}\n${data}`);
    }

    return {
        balance: new BN(data.stack[0][1].slice(2), 16),
        lastLt: data.last_transaction_id.lt,
        seqno: data.block_id.seqno,
    };
};

const sendJettonCollection = async (seed, seqno, collectionId, userId, jettonFromSeqno, jettonWalletAddress, jettonValue) => {
    const { wallet, keyPair } = getWalletFromSeed(seed);
    const address = await wallet.getAddress();

    const addressInfo = await tonweb.provider.getAddressInfo(address.toString());
    const tonBalance = BigInt(addressInfo.balance);
    if (tonBalance < MIN_BALANCE_TO_SEND_JETTONS) {
        if (addressInfo.block_id.seqno >= jettonFromSeqno) {
            await createTopupRequest(userId, collectionId);
        }
        return;
    }

    const jettonWallet = new TonWeb.token.jetton.JettonWallet(tonweb.provider, {
        address: jettonWalletAddress,
    });

    try {
        await wallet.methods.transfer({
            secretKey: keyPair.secretKey,
            toAddress: jettonWalletAddress,
            amount: new TonWeb.utils.BN(JETTON_TRANSFER_TON_VALUE.toString()),
            seqno,
            payload: await jettonWallet.createTransferBody({
                queryId: new TonWeb.utils.BN(collectionId),
                jettonAmount: new TonWeb.utils.BN(jettonValue),
                toAddress: new TonWeb.Address(COLD_WALLET_ADDRESS),
                responseAddress: address,
            }),
        }).send();
    } catch (e) {
        console.error(e);
    }
};

const collectJetton = async (userId, seed, depositId, jettonId, jettonWalletAddress) => {
    // todo: check for min deposit value etc

    const balanceData = await getJettonBalance(jettonWalletAddress);
    if (balanceData.balance.isZero()) {
        await markUserJettonDepositsAsProcessed(userId, jettonId, balanceData.lastLt);
        return;
    }

    let collectionId, seqno;
    try {
        const r = await createJettonCollection(userId, depositId, jettonId, balanceData.balance, balanceData.lastLt, balanceData.seqno);
        collectionId = r.id;
        seqno = r.seqno;
    } catch (e) {
        if (e.constraint_name !== 'collections_cause_deposit_id_key') {
            console.error(e);
        }
        return;
    }

    await sendJettonCollection(seed, seqno, collectionId, userId, balanceData.seqno, jettonWalletAddress, balanceData.balance);
};

export const collect = async () => {
    while (true) {
        try {
            const deposits = await getEarliestUnprocessedDeposits(DEPOSITS_PER_TICK);
            const processedUsers = {};

            for (const deposit of deposits) {
                if (deposit.userId in processedUsers) {
                    continue;
                }

                processedUsers[deposit.userId] = true;

                const unsentCollection = await getUnsentCollection(deposit.userId);
                if (unsentCollection !== undefined) {
                    console.log('Trying to send unsent collection', unsentCollection.seqno, unsentCollection.id);
                    if (unsentCollection.jettonId !== null) {
                        await sendJettonCollection(deposit.userSeed, unsentCollection.seqno, unsentCollection.id, deposit.userId, unsentCollection.jettonFromSeqno, await getUserJettonWallet(deposit.userId, unsentCollection.jettonId), unsentCollection.jettonValue);
                    } else {
                        await sendTonCollection(deposit.userSeed, unsentCollection.seqno, unsentCollection.id);
                    }
                    continue;
                }

                const jettonDeposit = await getEarliestUnprocessedJettonDeposit(deposit.userId);
                if (jettonDeposit !== undefined) {
                    console.log('Trying to collect jetton', deposit.userId, jettonDeposit.jettonId, jettonDeposit.id);
                    await collectJetton(deposit.userId, deposit.userSeed, jettonDeposit.id, jettonDeposit.jettonId, jettonDeposit.jettonWallet);
                    continue;
                }

                const addressInfo = await tonweb.provider.getAddressInfo(deposit.userWallet);

                if (BigInt(addressInfo.last_transaction_id.lt) < BigInt(deposit.txLt)) {
                    continue;
                }

                if (BigInt(addressInfo.balance) > MIN_BALANCE_TO_SEND) {
                    console.log('Trying to collect TON', deposit.userId, deposit.id);
                    await collectTon(deposit.userId, deposit.userSeed, deposit.id);
                } else {
                    await markUserDepositsAsProcessed(deposit.userId, addressInfo.last_transaction_id.lt);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            await sleep(1000);
        }
    }
};
