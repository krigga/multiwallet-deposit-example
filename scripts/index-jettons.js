import { COLD_WALLET_ADDRESS } from '../cold-wallet.js';
import { getJettonIdsAndAddresses, setJettonWallet } from '../db.js';
import { getJettonWallet } from '../utils.js';

async function main() {
    const jettons = await getJettonIdsAndAddresses();

    for (const jetton of jettons) {
        const wallet = await getJettonWallet(jetton.address, COLD_WALLET_ADDRESS);
        await setJettonWallet(jetton.id, wallet);
    }
}

main().then(() => process.exit());