import TonWeb from 'tonweb';
import fetch from 'node-fetch';

const isMainnet = false;

const mainnetKey = 'YOUR_MAINNET_API_KEY';
const testnetKey = 'YOUR_TESTNET_API_KEY';

const mainnetPrefix = 'https://toncenter.com';
const testnetPrefix = 'https://testnet.toncenter.com';

// Use toncenter.com as HTTP API endpoint to interact with TON blockchain.
// You can get HTTP API key at https://toncenter.com
// You can run your own HTTP API instance https://github.com/toncenter/ton-http-api
export const tonweb = new TonWeb(new TonWeb.HttpProvider((isMainnet ? mainnetPrefix : testnetPrefix) + '/api/v2/jsonRPC', {apiKey: isMainnet ? mainnetKey : testnetKey}));

export const queryV3 = async (url) => {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Key': isMainnet ? mainnetKey : testnetKey,
    };
    return fetch(`${isMainnet ? mainnetPrefix : testnetPrefix}/api/v3${url}`, {
        method: 'get',
        headers,
    })
    .then(r => r.json())
    .then(r => r.error ? Promise.reject(r.error) : r);
};
