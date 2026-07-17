import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chain-explorers.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const explorers = context.window.EvmoleBridgeOriginExplorers;
const address = '0x1111111111111111111111111111111111111111';

assert.equal(explorers.getChainIdFromName('Robinhood Chain'), '4663');
assert.equal(explorers.getChainIdFromDebridge('robinhood-chain'), '4663');
assert.equal(explorers.getChainIdFromDebridge('RobinhoodChain'), '4663');
assert.equal(explorers.getChainIdFromDebridge(100000001), '245022934');
assert.equal(explorers.getChainIdFromDebridge('100000031'), '4326');
assert.equal(explorers.getChainIdFromName('base'), '8453');
assert.equal(
    explorers.getExplorerUrl('Robinhood Chain', address),
    `https://robinhoodchain.blockscout.com/address/${address}`,
);
assert.equal(
    explorers.getExplorerUrl(100000031, address),
    `https://mega.etherscan.io/address/${address}`,
);
assert.equal(
    explorers.getExplorerUrl('solana', address),
    `https://solscan.io/account/${address}`,
);

console.log('chain explorers harness passed');
