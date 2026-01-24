# Evmole for Etherscan QOL

Chrome extension that adds function selectors and small QOL improvements to EVM block explorers.

## Features

- Function selector panel on contract pages (ignores standard ERC20 selectors)
- Quick buttons: "Incoming" and "CA Create" on transaction lists
- Auto-sets lists to 100 records per page
- Works across major EVM explorers

Supported explorers: Etherscan, Basescan, Blastscan, BSCScan, Arbiscan, Snowtrace/Snowscan, Polygonscan, Optimistic Etherscan, Lineascan, Worldscan, Abscan, Era.zksync, Scrollscan, and more.

## Screenshots

![Function Selector Panel](screenshot1.png)
![QOL Buttons](screenshot2.png)

## Install

1. Clone this repo
2. Open `chrome://extensions/`
3. Enable Developer mode
4. Load unpacked → select the extension directory

## Use

- Open any contract page (e.g., `https://etherscan.io/address/[contract_address]`)
- Use "Incoming" / "CA Create" on transaction list pages

## Security

- No external API calls
- No tracking or data collection
- Runs only on known explorer domains

## Credits

Uses [EVMole](https://github.com/cdump/evmole) to extract selectors from bytecode.
