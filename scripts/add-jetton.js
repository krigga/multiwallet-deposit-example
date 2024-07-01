import { COLD_WALLET_ADDRESS } from '../cold-wallet.js';
import { createJetton, getUserIdsAndWallets, createJettonWallet } from '../db.js';
import { getJettonWallet } from '../utils.js';

async function main() {
    if (process.argv.length < 4) {
        console.error('usage: add-jetton.js jetton-name jetton-master-address');
        return;
    }

    const name = process.argv[2];
    const masterAddress = process.argv[3];

    const jettonId = await createJetton(name, masterAddress, await getJettonWallet(masterAddress, COLD_WALLET_ADDRESS));

    for (const user of await getUserIdsAndWallets()) {
        await createJettonWallet(user.id, jettonId, await getJettonWallet(masterAddress, user.wallet));
    }
}

main().then(() => process.exit());
