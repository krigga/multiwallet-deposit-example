import TonWeb from 'tonweb';
import { tonweb } from './api.js';

export async function getJettonWallet(jettonMaster, user) {
    const jettonMinter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, {
        address: jettonMaster,
    });
    const jettonWalletAddress = await jettonMinter.getJettonWalletAddress(new TonWeb.Address(user));
    return jettonWalletAddress.toString(true, true, true);
}

export function sleep(timeout) {
    return new Promise(res => setTimeout(res, timeout));
}

export function getWalletFromSeed(seed, isHex = true) {
    const keyPair = TonWeb.utils.keyPairFromSeed(isHex ? TonWeb.utils.hexToBytes(seed) : seed);
    const wallet = new tonweb.wallet.all.v3R2(tonweb.provider, { publicKey: keyPair.publicKey });
    return { keyPair, wallet };
}
