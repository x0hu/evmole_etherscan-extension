# Evmole for Etherscan QOL

Chrome extension for Etherscan-style explorers that adds contract-analysis and transaction-page quality-of-life tooling.

## What It Adds

- Contract function selector panel on `address/*` and `token/*` pages
- Transaction input calldata decoding on `tx/*` pages
- List-page QOL actions like quick "Incoming" / "CA Create" filters
- Auto-sets transaction list page size to 100 when supported

Supported explorers include Etherscan, Basescan, Blastscan, BSCScan, Arbiscan, Snowtrace/Snowscan, Polygonscan, Optimistic Etherscan, Lineascan, Worldscan, Scrollscan, and other Etherscan-family scanners configured in `manifest.json`.

## Screenshot

![Function Selector Panel](screenshot1.png)
![Transaction Input Decode View](txcalldataDecoded.png)

## Install

1. Clone this repository.
2. Open `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked` and select this folder.

## Notes

- The extension runs only on explorer domains listed in `manifest.json`.
- It does not include analytics or user tracking.
- Signature decoding may query public signature services when a selector is unknown locally.

## Credits

- [EVMole](https://github.com/cdump/evmole) for selector extraction from bytecode.
- [abi-guesser](https://github.com/openchainxyz/abi-guesser) for ABI inference techniques that informed calldata decoding behavior.
- [swiss-knife](https://github.com/swiss-knife-xyz/swiss-knife) for EVM calldata decoding inspiration and reference patterns.
