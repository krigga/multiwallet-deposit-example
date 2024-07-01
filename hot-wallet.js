import TonWeb from 'tonweb';
import TonWebMnemonic from 'tonweb-mnemonic';
import { tonweb } from './api.js';

// todo: set your own seed phrase
const MNEMONIC = 'word1 word2 ..';
export const HIGHLOAD_WALLET_TIMEOUT = 60 * 60;

let highloadWallet = undefined;
let highloadAddress = undefined;

export async function getHotWallet() {
    if (highloadWallet) {
        return highloadWallet;
    }

    const seed = await TonWebMnemonic.mnemonicToSeed(MNEMONIC.split(' '));
    const keyPair = TonWeb.utils.keyPairFromSeed(seed);
    const {HighloadWalletContractV3} = TonWeb.HighloadWallets;
    highloadWallet = new HighloadWalletContractV3(tonweb.provider, {
        publicKey: keyPair.publicKey,
        timeout: HIGHLOAD_WALLET_TIMEOUT,
    });
    return { highloadWallet, keyPair };
}

export async function getHotWalletAddress() {
    if (highloadAddress) {
        return highloadAddress;
    }

    highloadAddress = (await getHotWallet()).getAddress();

    return highloadAddress;
}
