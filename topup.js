import TonWeb from 'tonweb';
import { getLastKnownHotWalletTxUtime, getNextQueryId, getUnprocessedTopupRequests, setNextQueryId, setTopupRequestQueryIdAndCreatedAt, recreateTopupRequest } from './db.js';
import { tonweb } from './api.js';
import { getHotWallet, HIGHLOAD_WALLET_TIMEOUT } from './hot-wallet.js';

const {HighloadQueryId} = TonWeb.HighloadWallets;

const sendWithdrawalRequest = async (highloadWallet, keyPair, withdrawalRequest) => {
    const transfer = highloadWallet.methods.transfer({
        secretKey: keyPair.secretKey,
        queryId: HighloadQueryId.fromQueryId(withdrawalRequest.queryId),
        createdAt: withdrawalRequest.createdAt,
        toAddress: new TonWeb.Address(withdrawalRequest.toAddress).toString(true, true, false),
        amount: withdrawalRequest.amount,
        needDeploy: withdrawalRequest.queryId === 0n
    });

    return transfer.send();
}

export const topup = async () => {
    const { highloadWallet, keyPair } = await getHotWallet();

    const hotWalletAddress = await highloadWallet.getAddress();
    const hotWalletAddressString = hotWalletAddress.toString(true, true, false);
    console.log('My HOT wallet is', hotWalletAddressString);

    let isProcessing = false;

    const nextQueryId = await getNextQueryId();

    console.log('Next query id', nextQueryId);

    let queryId = HighloadQueryId.fromQueryId(nextQueryId);

    const tick = async () => {
        if (isProcessing) return;
        isProcessing = true;

        try {

        console.log('Withdraw tick');

        const lastKnownTxUtime = await getLastKnownHotWalletTxUtime();

        const withdrawalRequests = await getUnprocessedTopupRequests();

        console.log(withdrawalRequests.length + ' requests');

        if (withdrawalRequests.length === 0) return; // nothing to withdraw

        const now = (await tonweb.provider.getExtendedAddressInfo(hotWalletAddressString)).sync_utime;

        for (const withdrawalRequest of withdrawalRequests) {
            if (withdrawalRequest.queryId === null) { // not sent yet
                withdrawalRequest.queryId = queryId.getQueryId();

                if (queryId.hasNext()) {
                    queryId = queryId.getNext();
                } else {
                    console.log('Recreated query id');
                    queryId = new HighloadQueryId(); // reset, start from 0 again
                }

                withdrawalRequest.createdAt = now;

                await setNextQueryId(queryId.getQueryId());
                await setTopupRequestQueryIdAndCreatedAt(withdrawalRequest.id, withdrawalRequest.queryId, withdrawalRequest.createdAt);

                try {
                    await sendWithdrawalRequest(highloadWallet, keyPair, withdrawalRequest);
                } catch (e) {
                    console.error(e);
                }

                console.log('Set query id and created at for request', withdrawalRequest.id);
            } else {

                if (withdrawalRequest.createdAt < lastKnownTxUtime - HIGHLOAD_WALLET_TIMEOUT) {
                    // expired
                    await recreateTopupRequest(withdrawalRequest);
                    console.log('Recreated request', withdrawalRequest.id);
                } else {

                    try {
                        await sendWithdrawalRequest(highloadWallet, keyPair, withdrawalRequest);
                    } catch (e) {}
                    console.log('Resending request', withdrawalRequest.id);

                }
            }

        }

        } catch (e) { console.error(e); } finally {
            isProcessing = false;
        }
    }

    setInterval(tick, 8 * 1000);
    tick();
}
