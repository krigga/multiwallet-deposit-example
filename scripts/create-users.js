import { createJettonWallet, createUser, getJettonIdsAndAddresses } from '../db.js';
import { getJettonWallet } from '../utils.js';

async function main() {
    const jettons = await getJettonIdsAndAddresses();

    const count = Number(process.argv[2] ?? 1);
    for (let i = 0; i < count; i++) {
        const { id, wallet } = await createUser();
        for (const jetton of jettons) {
            const jettonWallet = await getJettonWallet(jetton.address, wallet);
            await createJettonWallet(id, jetton.id, jettonWallet);
        }
    }
}

main().then(() => process.exit());
