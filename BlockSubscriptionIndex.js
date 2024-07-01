// Subscribing to blocks using Index HTTP API - https://toncenter.com/api/v3 or https://testnet.toncenter.com/api/v3

import { queryV3 } from './api.js';

export class BlockSubscriptionIndex {
    constructor(lastProcessedMasterchainBlockNumber, onTransaction, onBlockProcessed) {
        this.lastProcessedMasterchainBlockNumber = lastProcessedMasterchainBlockNumber;  // saved in DB; last masterchain block number that your service processed
        this.onTransaction = onTransaction;
        this.onBlockProcessed = onBlockProcessed;
    }

    start() {
        const TX_LIMIT = 128;

        const getTransactionsByMasterchainBlock = (mcBlock, limit, offset) => {
            return queryV3(`/transactionsByMasterchainBlock?seqno=${mcBlock}&limit=${limit}&offset=${offset}`);
        };

        const getMasterchainInfo = () => {
            return queryV3(`/masterchainInfo`);
        };

        let isProcessing = false;

        const tick = async () => {
            if (isProcessing) return;
            isProcessing = true;

            try {
                const masterchainInfo = await getMasterchainInfo(); // get last masterchain info from node
                const lastMasterchainBlockNumber = masterchainInfo.last.seqno;

                if (lastMasterchainBlockNumber > this.lastProcessedMasterchainBlockNumber) {
                    const masterchainBlockNumber = this.lastProcessedMasterchainBlockNumber + 1;

                    console.log('Got masterchain block ' + masterchainBlockNumber + ' and related shard blocks');

                    let offset = 0;
                    while (true) {
                        const txs = (await getTransactionsByMasterchainBlock(masterchainBlockNumber, TX_LIMIT, offset)).transactions;
                        for (const tx of txs) {
                            await this.onTransaction(tx);
                        }

                        if (txs.length < TX_LIMIT) {
                            break;
                        }
                        offset += TX_LIMIT;
                    }

                    this.lastProcessedMasterchainBlockNumber = masterchainBlockNumber; // save in DB
                    await this.onBlockProcessed(masterchainBlockNumber);
                }
            } catch (e) {
                console.error(e);
            } finally {
                isProcessing = false;
            }
        }

        setInterval(tick, 1000); // new masterchain block created every ~5 seconds
    }
}