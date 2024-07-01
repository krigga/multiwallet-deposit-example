import { getUnprocessedUserTonDepositsBeforeLt, getUnprocessedUserJettonDepositsBeforeLt, markDepositsAsProcessed } from './db.js';

export const onDepositProcessed = async (id, value) => {
    console.log(`Deposit ${id} (value ${value}) processed`);
}

export const markUserDepositsAsProcessed = async (userId, beforeLt) => {
    const deposits = await getUnprocessedUserTonDepositsBeforeLt(userId, beforeLt);
    for (const deposit of deposits) {
        await onDepositProcessed(deposit.id, deposit.value);
    }
    await markDepositsAsProcessed(deposits.map(e => e.id));
};

export const markUserJettonDepositsAsProcessed = async (userId, jettonId, beforeLt) => {
    const deposits = await getUnprocessedUserJettonDepositsBeforeLt(userId, jettonId, beforeLt);
    for (const deposit of deposits) {
        await onDepositProcessed(deposit.id, deposit.value);
    }
    await markDepositsAsProcessed(deposits.map(e => e.id));
};
