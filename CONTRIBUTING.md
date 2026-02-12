# Contributing

## Project Overview

Chrome extension (Manifest V3) that adds function selector panels and QOL buttons to Etherscan-family EVM block explorers. Raw JS, no build system. Uses [EVMole](https://github.com/cdump/evmole) for bytecode selector extraction and [viem](https://viem.sh) for RPC calls, both loaded from CDN.

## Repository Structure

```
.
├── manifest.json                  # MV3 manifest; defines content scripts + web-accessible resources
├── content.js                     # Main content script: injects panel UI, handles selector display + query results
├── evmole-script.js               # Web-accessible module: EVMole extraction, proxy detection, RPC queries (runs in page context)
├── decode_calldata.js             # Content script for /tx pages: decodes calldata with ABI guessing + adapter system
├── etherscan_contract_info.js     # Content script: extracts/displays contract header comments from source code
├── qol_buttons.js                 # Content script: adds "Incoming" / "CA Create" buttons, auto-selects 100 rows
├── styles.css                     # Web-accessible stylesheet for the function selector panel
├── README.md                      # Install + usage docs
├── .gitignore                     # Ignores .devcontainer/
├── .gitattributes                 # LF normalization
├── screenshot1.png                # Function selector panel screenshot
├── screenshot2.png                # QOL buttons screenshot
└── .devcontainer/                 # Dev container config (Docker + fish shell + Claude Code / Codex)
    ├── devcontainer.json          # Container definition, VS Code settings, volume mounts
    ├── Dockerfile                 # Node 22 + Ubuntu 25.10, installs Claude Code + Codex CLI
    ├── post_install.py            # Post-create setup: fish config, shell history, agent configs
    └── .gitignore_global          # Global gitignore template for container
```

## Key Files

| File | Purpose |
|---|---|
| `manifest.json` | Declares content scripts (2 groups: address/token/tx pages + tx-only), web-accessible resources, supported explorer domains (25+ chains) |
| `content.js` | Entry point for contract pages. Creates collapsible right-side panel, injects `evmole-script.js` into page, listens for `postMessage` results |
| `evmole-script.js` | ES module running in page context. Extracts selectors via EVMole, detects proxies (EIP-1967/1822/1167), queries read functions via viem RPC |
| `decode_calldata.js` | IIFE for tx pages. Full ABI decoder with signature lookup (OpenChain + 4byte), backtracking ABI structure guesser, adapter system for ERC-4337/7579, nested decode + unit conversion UI |
| `etherscan_contract_info.js` | Fetches contract source, extracts NatSpec/header comments, displays in left-side panel |
| `qol_buttons.js` | Adds "Incoming" and "CA Create" filter buttons on tx list pages, auto-sets 100 records/page |
| `styles.css` | Dark theme panel styles, collapsed/expanded states, query result formatting, tuple display |

## Getting Started

No deps to install. No build step.

1. Clone repo
2. Go to `chrome://extensions/` (or `brave://extensions/`)
3. Enable Developer mode
4. "Load unpacked" -> select this directory
5. Navigate to any supported explorer contract/tx page

To reload after changes: click the refresh icon on the extension card in `chrome://extensions/`.

## Development Workflow

- No formal branch/PR conventions observed in history. Commits go direct to `main`.
- Commit messages: short imperative style, often lowercase. Examples: `add read function query no args`, `fix proxy implementation pattern`.
- No CI/CD. No tests. Manual testing on live explorer pages.
- No package.json or build tooling.

### Adding a new chain

1. Add `matches` entries in `manifest.json` for address/token/tx/txs paths
2. Add the domain to `web_accessible_resources` matches
3. Add tx-page match in the second content_scripts entry (for `decode_calldata.js`)
4. Add RPC endpoints in `CHAIN_CONFIG` inside `evmole-script.js`

### Adding a new known selector

Add entry to `KNOWN_SELECTORS` in `decode_calldata.js`.

### Adding a decode adapter

Call `registerDecodeAdapter({ id, match, decode })` in `decode_calldata.js`. See `erc4337_handleops_packed_v07` and `execute_bytes32_bytes_packed_single_call` adapters for examples.

## Architecture Notes

**Two execution contexts per page:**

1. **Content script context** (`content.js`, `decode_calldata.js`, `etherscan_contract_info.js`, `qol_buttons.js`) -- has `chrome.*` API access, injects UI into the DOM
2. **Page context** (`evmole-script.js`) -- injected via `<script type="module">`, imports EVMole + viem from CDN, communicates back via `window.postMessage`

**Data flow (contract pages):**

```
content.js  --injects-->  evmole-script.js (page context)
                              |
                              | extracts bytecode from HTML or RPC
                              | detects proxy -> fetches impl bytecode
                              | runs EVMole -> gets selectors
                              | looks up signatures (OpenChain API)
                              |
                              +--postMessage('FUNCTION_SELECTORS_RESULT')-->  content.js (builds panel UI)
                              |
content.js  --postMessage('QUERY_READ_FUNCTION')-->  evmole-script.js
                              |
                              | calls contract via viem RPC
                              |
                              +--postMessage('QUERY_RESULT')-->  content.js (displays result)
```

**Data flow (tx pages):**

```
decode_calldata.js
  | reads #inputdata element
  | selector -> adapter check -> signature lookup (OpenChain/4byte) -> ABI decode
  | if no signature: backtracking DFS ABI guesser (ported from @openchainxyz/abi-guesser)
  | renders decoded params inline below input data
  | nested bytes auto-expand recursively
```

**Proxy detection chain:** EIP-1167 bytecode pattern -> storage slot checks (EIP-1967, EIP-1822, Zeppelin, self-slot) -> `implementation()` call. Skips RPC if bytecode > 10k chars or selector count >= 8.
