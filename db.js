import postgres from 'postgres';
import TonWeb from 'tonweb';
import { getWalletFromSeed } from './utils.js';

const BN = TonWeb.utils.BN;
const TOPUP_AMOUNT = 75000000n; // 0.075 TON

// todo: set your own url
const sql = postgres('POSTGRES_URL');

export async function createUser() {
    const seed = TonWeb.utils.newSeed();
    const address = await getWalletFromSeed(seed, false).getAddress();
    const unbounceableAddress = address.toString(true, true, false);
    const [{ id }] = await sql`insert into users (wallet, seed) values (${unbounceableAddress}, ${TonWeb.utils.bytesToHex(seed)}) returning id`;
    return { id, wallet: unbounceableAddress };
}

export async function createJetton(name, masterAddress, wallet) {
    const [{ id }] = await sql`insert into jettons (name, address, wallet) values (${name}, ${masterAddress}, ${wallet}) returning id`;
    return id;
}

export async function getUserIdsAndWallets() {
    return await sql`select id, wallet from users`;
}

export async function createJettonWallet(userId, jettonId, jettonWallet) {
    await sql`insert into users_jettons (user_id, jetton_id, jetton_wallet) values (${userId}, ${jettonId}, ${jettonWallet})`;
}

export async function getJettonIdsAndAddresses() {
    return await sql`select id, address from jettons`;
}

export async function getUserIdByWallet(wallet) {
    const r = await sql`select id from users where wallet = ${wallet} limit 1`;
    if (r.length === 0) {
        return undefined;
    }
    return r[0].id;
}

export async function createTonDeposit(userId, value, txHash, txLt, processed = false) {
    const [{ id }] = await sql`insert into deposits (user_id, value, tx_hash, tx_lt, jetton_id, processed) values (${userId}, ${value}, ${txHash}, ${txLt}, null, ${processed}) on conflict do nothing returning id`;
    return id;
}

export async function getEarliestUnprocessedDeposits(limit) {
    return (await sql`select deposits.id, user_id, value, jetton_id, tx_hash, tx_lt, users.wallet, users.seed, users.seqno from deposits join users on users.id = deposits.user_id where deposits.processed = false order by id asc limit ${limit}`).map(e => ({ id: e.id, userId: e.user_id, value: BigInt(e.value), jettonId: e.jetton_id, txHash: e.tx_hash, txLt: e.tx_lt, userWallet: e.wallet, userSeed: e.seed, userSeqno: e.seqno }));
}

export async function getUnprocessedUserTonDepositsBeforeLt(userId, lt) {
    return await sql`select id, value from deposits where user_id = ${userId} and processed = false and jetton_id is null and tx_lt <= ${lt}`;
}

export async function markDepositsAsProcessed(ids) {
    await sql`update deposits set processed = true where id in ${ sql(ids) }`;
}

export async function getTonCollectionUser(collectionId) {
    const [user] = await sql`select users.id, users.wallet from collections join users on users.id = collections.user_id where collections.id = ${collectionId} limit 1`;
    return user;
}

export async function getEarliestUnprocessedJettonDeposit(userId) {
    const results = await sql`select deposits.id, deposits.jetton_id, users_jettons.jetton_wallet from deposits join users_jettons on users_jettons.user_id = deposits.user_id and users_jettons.jetton_id = deposits.jetton_id where deposits.user_id = ${userId} and deposits.jetton_id is not null and processed = false order by id asc limit 1`;
    if (results.length === 0) {
        return undefined;
    }
    return { id: results[0].id, jettonId: results[0].jetton_id, jettonWallet: results[0].jetton_wallet };
}

export async function getUserAndJettonIdByJettonWallet(wallet) {
    const results = await sql`select user_id, jetton_id from users_jettons where jetton_wallet = ${wallet} limit 1`;
    if (results.length === 0) {
        return undefined;
    }
    return { userId: results[0].user_id, jettonId: results[0].jetton_id };
}

export async function createJettonDeposit(userId, jettonId, txHash, txLt) {
    await sql`insert into deposits (user_id, value, tx_hash, tx_lt, jetton_id) values (${userId}, '0', ${txHash}, ${txLt}, ${jettonId}) on conflict do nothing`;
}

export async function createTopupRequest(userId, causeDepositId) {
    await sql`insert into topup_requests (user_id, cause_deposit_id) values (${userId}, ${causeDepositId}) on conflict do nothing`;
}

export async function getJettonIdByJettonWallet(wallet) {
    const results = await sql`select id from jettons where wallet = ${wallet} limit 1`;
    if (results.length === 0) {
        return undefined;
    }
    return results[0].id;
}

export async function setJettonWallet(id, wallet) {
    await sql`update jettons set wallet = ${wallet} where id = ${id}`;
}

export async function setTopupRequestProcessedAndSent(queryId, createdAt, sent) {
    await sql`update topup_requests set processed = true, sent = ${sent} where query_id = ${queryId} and created_at = ${createdAt}`;
}

export async function getLastKnownHotWalletTxUtime() {
    const [{ value }] = await sql`select value from globals where id = 'last_known_tx_utime'`;
    return Number(value);
}

export async function updateLastKnownHotWalletTxUtime(utime) {
    if (await getLastKnownHotWalletTxUtime() < utime) {
        await sql`update globals set value = ${utime} where id = 'last_known_tx_utime'`;
    }
}

export async function getNextQueryId() {
    return BigInt((await sql`select value from globals where id = 'next_query_id'`)[0].value);
}

export async function getUnprocessedTopupRequests() {
    const result = await sql`select topup_requests.*, users.wallet from topup_requests join users on users.id = topup_requests.user_id where processed = false and was_recreated = false order by id asc limit 100`;

    return result.map(e => ({ id: e.id, amount: new BN(TOPUP_AMOUNT.toString()), toAddress: e.wallet, queryId: e.query_id === null ? null : BigInt(e.query_id), createdAt: Number(e.created_at), userId: e.user_id }));
}

export async function setNextQueryId(queryId) {
    await sql`update globals set value = ${queryId.toString()} where id = 'next_query_id'`;
}

export async function setTopupRequestQueryIdAndCreatedAt(id, queryId, createdAt) {
    await sql`update topup_requests set query_id = ${queryId}, created_at = ${createdAt} where id = ${id}`;
}

export async function recreateTopupRequest(request) {
    await sql.begin(async sql => {
        await sql`update topup_requests set was_recreated = true where id = ${request.id}`;
        await sql`insert into topup_requests (user_id) values (${request.userId})`;
    })
}

export async function getTonCollectionIdForUser(userId, aboveLt) {
    const results = await sql`select id from collections where user_id = ${userId} and jetton_id is null and lt > ${aboveLt}`;
    if (results.length === 0) {
        return undefined;
    }
    return results[0].id;
}

export async function getLastProcessedMcBlock() {
    const [{ value }] = await sql`select value from globals where id = 'last_processed_mc_block' limit 1`;
    return Number(value);
}

export async function setLastProcessedMcBlock(b) {
    await sql`update globals set value = ${b} where id = 'last_processed_mc_block'`;
}

export async function getUnprocessedUserJettonDepositsBeforeLt(userId, jettonId, lt) {
    return await sql`select id, value from deposits where user_id = ${userId} and processed = false and jetton_id = ${jettonId} and tx_lt <= ${lt}`;
}

export async function createJettonCollection(userId, causeDepositId, jettonId, jettonValue, jettonFromLt, jettonFromSeqno) {
    return await sql.begin(async sql => {
        const [{ seqno }] = await sql`select seqno from users where id = ${userId} limit 1`;
        const [{ id }] = await sql`insert into collections (user_id, seqno, cause_deposit_id, jetton_id, jetton_value, jetton_from_lt, jetton_from_seqno) values (${userId}, ${seqno}, ${causeDepositId}, ${jettonId}, ${jettonValue}, ${jettonFromLt}, ${jettonFromSeqno}) returning id`;
        await sql`update users set seqno = ${seqno + 1} where id = ${userId}`;
        return { id, seqno };
    });
}

export async function createTonCollection(userId, causeDepositId) {
    return await sql.begin(async sql => {
        const [{ seqno }] = await sql`select seqno from users where id = ${userId} limit 1`;
        const [{ id }] = await sql`insert into collections (user_id, seqno, cause_deposit_id) values (${userId}, ${seqno}, ${causeDepositId}) returning id`;
        await sql`update users set seqno = ${seqno + 1} where id = ${userId}`;
        return { id, seqno };
    });
}

export async function getUnsentCollection(userId) {
    const results = await sql`select id, seqno, cause_deposit_id, jetton_id, jetton_value, jetton_from_seqno from collections where user_id = ${userId} and lt is null order by id asc limit 1`;
    if (results.length === 0) {
        return undefined;
    }
    const r = results[0];
    return { id: r.id, seqno: r.seqno, causeDepositId: r.cause_deposit_id, jettonId: r.jetton_id, jettonValue: r.jetton_value, jettonFromSeqno: r.jetton_from_seqno };
}

export async function getUserJettonWallet(userId, jettonId) {
    const [{ jetton_wallet }] = await sql`select jetton_wallet from users_jettons where user_id = ${userId} and jetton_id = ${jettonId} limit 1`;
    return jetton_wallet;
}

export async function getUserSeqno(userId) {
    const [{ seqno }] = await sql`select seqno from users where id = ${userId} limit 1`;
    return seqno;
}

export async function confirmCollection(userId, seqno, lt, success) {
    await sql`update collections set lt = ${lt}, success = ${success} where user_id = ${userId} and seqno = ${seqno}`;
}

export async function getCollectionInfo(collectionId, jettonId) {
    const [{ user_id, cause_deposit_id, jetton_from_lt }] = await sql`select user_id, cause_deposit_id, jetton_from_lt from collections where id = ${collectionId} and jetton_id = ${jettonId} limit 1`;
    return {
        userId: user_id,
        causeDepositId: cause_deposit_id,
        jettonFromLt: jetton_from_lt,
    };
}

export async function getUserWallet(userId) {
    const [{ wallet }] = await sql`select wallet from users where id = ${userId} limit 1`;
    return wallet;
}

export async function getUserJettonDepositsAndConfirm(jettonId, userId, lt, value, valuedId) {
    await sql`update deposits set value = ${value}, processed = true where id = ${valuedId}`;
    const others = await sql`select id from deposits where user_id = ${userId} and jetton_id = ${jettonId} and processed = false and tx_lt <= ${lt}`;
    const othersIds = others.map(d => d.id);
    await sql`update deposits set processed = true where id in ${sql(othersIds)}`;
    return othersIds;
}
