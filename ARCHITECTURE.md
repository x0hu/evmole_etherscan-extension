# Architecture

Detailed breakdown of the EVMole Etherscan Extension codebase. ~4,500 lines of raw JS (no build system, no dependencies beyond the EVMole CDN import).

## File Map

| File | Lines | Role |
|------|-------|------|
| `manifest.json` | 219 | MV3 config: content script groups, permissions, supported domains |
| `content.js` | 502 | Main content script: right-side panel, selector display, query execution |
| `evmole-script.js` | 776 | Page-context module: bytecode extraction, proxy detection, hedged RPC |
| `decode_calldata.js` | 2076 | Tx-page calldata decoder: ABI guesser, adapters, nested decode UI |
| `etherscan_contract_info.js` | 167 | Left-side panel: NatSpec/header comment extraction from source |
| `qol_buttons.js` | 328 | UX buttons: Incoming/CA Create filters, funded tx copy, 100-row auto-select |
| `remove_from_page_qol.js` | 131 | Early ad/sponsored element removal (runs at document_start) |
| `styles.css` | 478 | Dark theme panel + decoded output styling |

## Execution Contexts

Every page load creates two isolated worlds:

1. **Content script context** — `content.js`, `decode_calldata.js`, `etherscan_contract_info.js`, `qol_buttons.js`, `remove_from_page_qol.js`. Has `chrome.*` API access, manipulates the DOM directly.

2. **Page context** — `evmole-script.js`. Injected as `<script type="module">` so it can import the EVMole library from CDN and make direct `fetch()` calls to RPC endpoints (content scripts can't do cross-origin fetches without host permissions). Communicates back to the content script world via `window.postMessage`.

## Content Script Groups (manifest.json)

Three injection groups with different triggers:

| Group | Scripts | Pages | Timing |
|-------|---------|-------|--------|
| 1 | `content.js`, `etherscan_contract_info.js`, `qol_buttons.js` | `/address/*`, `/token/*`, `/tx*`, `/txs*` | document_idle |
| 2 | `remove_from_page_qol.js` + `.css` | `/address/*`, `/tx*` | document_start |
| 3 | `decode_calldata.js` | `/tx/*` only | document_idle |

Web-accessible resources: `evmole-script.js` and `styles.css` (needed for page-context injection and panel styling).

Supported explorers: 30+ Etherscan-family domains (Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, BSC, zkSync, Scroll, Linea, Blast, Fraxtal, Taiko, HyperEVM, Monad, MegaETH, and their testnets).

---

## Contract Pages (`content.js` + `evmole-script.js`)

### Data Flow

```
content.js (content script)
  │
  ├─ checks for bytecode element or code editor
  ├─ creates right-side panel ("Loading...")
  ├─ injects evmole-script.js into page context
  │
  │   evmole-script.js (page context)
  │   ├─ getBytecodeFromHTML()
  │   │   multi-pass DOM scan: deployed bytecode → creation code → unverified
  │   │   excludes ace editor elements (source code)
  │   │   falls back to RPC eth_getCode if HTML parse fails
  │   │
  │   ├─ detectProxyImplementation()
  │   │   1. EIP-1167 minimal proxy regex (instant, no RPC)
  │   │   2. skip if bytecode > 10k chars or >= 8 selectors found
  │   │   3. parallel storage slot checks:
  │   │      EIP-1967, EIP-1822, OpenZeppelin v1, self-slot
  │   │   4. implementation() call fallback
  │   │   5. Safe proxy runtime fingerprint → inject fallback selectors
  │   │
  │   ├─ EVMole.functionSelectors(bytecode)
  │   │   + functionArguments() + functionStateMutability()
  │   │
  │   ├─ fetchSignatures() via OpenChain API (batch)
  │   │
  │   └─ postMessage('FUNCTION_SELECTORS_RESULT')
  │       payload: [{selector, signature, arguments, mutability}, ...], implAddress
  │
  ├─ renders panel: read functions (view/pure) | write functions
  │   - non-standard ERC20 functions highlighted (orange border)
  │   - no-arg read functions marked "query" (clickable)
  │
  └─ on Query click → postMessage('QUERY_READ_FUNCTION')
      │
      │   evmole-script.js
      │   ├─ hedgedReadCall() → eth_call
      │   ├─ decode chain: getOwners special case → string → tuple → single word → raw hex
      │   └─ postMessage('QUERY_RESULT')
      │
      └─ renders result: copy button, unit dropdown (Wei/Gwei/ETH/10^6),
         format toggle (Dec/Hex/Auto), address links, expandable strings
```

### Hedged RPC Layer

All chain reads (eth_call, eth_getCode, eth_getStorageAt) go through a custom hedging system:

- **Staggered parallel requests:** launches up to 3 RPCs with 180ms delays between them
- **First valid response wins:** remaining in-flight requests are aborted via AbortController
- **Per-endpoint cooldown:** tracks failing RPCs and temporarily skips them
  - 429 (rate limit) → 2 minute cooldown
  - 403 (forbidden) → 10 minute cooldown
  - Network/CORS error → 30 second cooldown
- **Chain-specific RPC lists:** each of the 30+ chains has 3–11 endpoints (Tenderly, DRPC, Alchemy, Ankr, etc.)
- Base has the largest backup list (most failure-prone)

### Query Result Decoding

`evmole-script.js` decodes eth_call responses through a priority chain:

1. **getOwners() special case** — explicit `address[]` ABI decoding
2. **String detection** — validates ABI offset/length structure + UTF-8
3. **Tuple (multi-word)** — `autoDecodeTuple()` runs a 2-pass heuristic:
   - Pass 1: detect string offsets pointing to ABI-encoded dynamic strings
   - Pass 2: classify each chunk (address/bool/uint/bytes) based on leading zeros
4. **Single word** — name-based heuristics (isX/hasX → bool, owner/admin → address)
5. **Fallback** — raw hex

### Panel UI

- Fixed right-side panel, 400px wide, dark theme, max-height 80vh scrollable
- Collapsible: strips all metadata, shrinks to 200px showing only selector names
- Close button removes entire container
- Query dropdowns stay open during interaction (click events on inner controls don't collapse)
- Address values rendered as links to current explorer's `/address/{addr}`

---

## Transaction Pages (`decode_calldata.js`)

### Decode Pipeline

```
injectDecoder() — triggered on DOMContentLoaded + MutationObserver
  │
  ├─ reads #inputdata element, extracts hex calldata
  ├─ extracts 4-byte selector
  │
  ├─ 1. Protocol Adapters (first pass)
  │     registered via registerDecodeAdapter({id, match, decode})
  │     ├─ ERC4337 handleOps v0.7 (0x765e827f) — packed struct layout
  │     ├─ ERC4337 handleOps v0.6 (0x1fad948c) — older struct fields
  │     └─ ERC7579 execute(bytes32,bytes) (0xe9ae5c53)
  │         mode byte → callType:
  │         0x00 = single (address,uint256,bytes)
  │         0x01 = batch (address,uint256,bytes)[]
  │         0xff = delegatecall (address,bytes)
  │         tries: packed → ABI-encoded → raw bytes
  │
  ├─ 2. Signature Lookup
  │     local: KNOWN_SELECTORS (27 common ERC20/NFT/DEX/AA selectors)
  │     remote: OpenChain API → 4byte.directory fallback
  │     if found → parseSignatureTypes() → decodeParam() for each type
  │
  ├─ 3. ABI Structure Guesser (no signature found)
  │     tryGuessABIStructure() → guessAbiEncodedData()
  │     trims trailing non-word-aligned bytes (protocol metadata)
  │     └─ decodeWellFormedTuple() — backtracking DFS
  │         ├─ walks static head region, classifies each word:
  │         │   valid offset? → dynamic param (with or without length)
  │         │   not an offset? → static bytes32
  │         ├─ resolves dynamic params:
  │         │   length matches data size → bytes
  │         │   no length → recursive tuple parse
  │         │   ambiguous → tries all interpretations:
  │         │     dynamic array (with length prefix)
  │         │     dynamic array (without length prefix)
  │         │     static array of fixed elements
  │         │   picks shortest valid type
  │         └─ gInferTypes() refines guessed types from values:
  │             12 leading zeros → address
  │             trailing zeros → bytes<N>
  │             valid UTF-8 → string
  │             many leading zeros → uint256
  │
  ├─ 4. Heuristic Fallback (guesser failed)
  │     word-by-word analyzeWord():
  │     ├─ 12 zero bytes + 20-byte value → address
  │     ├─ 0 or 1 → bool
  │     ├─ valid pointer to length-prefixed data → string/bytes
  │     ├─ pointer to array of offsets → bytes[]
  │     ├─ < 256 → uint8, < 65536 → uint16
  │     ├─ 1B–2B range → timestamp
  │     └─ default → uint256
  │     tracks decoded ranges to avoid double-counting dynamic data
  │
  └─ renders decoded UI inline below input data
```

### Core ABI Decoder

`decodeParam(data, offset, type)` — type-driven recursive decoder:

| Type | Behavior |
|------|----------|
| `address` | Extract last 20 bytes |
| `bool` | Check if value === 1n |
| `uint*`/`int*` | BigInt conversion, two's complement for signed |
| `bytes32` | Return as-is hex |
| `string`/`bytes` | Follow pointer → read length → extract content, UTF-8 check for string |
| `type[]` | Follow pointer → read array length → decode each element (static: sequential, dynamic: offset-based) |
| `(type,type,...)` | Static tuple: inline decode. Dynamic tuple: pointer + head/tail resolution |

Supporting functions:
- `decodeDynamic()` — string/bytes via offset pointer
- `decodeArray()` — static and dynamic element arrays (capped at 20 elements)
- `decodeTupleInline()` — static tuples decoded sequentially from current offset
- `decodeTuple()` — dynamic tuples: reads head values (direct or offset), resolves dynamic members relative to tuple start

### Nested Decode & Auto-Expand

Decoded `bytes` values that look like calldata get a "Decode" button:

- `couldBeCalldata()` — >= 10 hex chars, non-zero selector
- `shouldAutoExpandCalldata()` — known selector or valid word-aligned structure
- Auto-expansion runs recursively with bounded parallelism:

| Limit | Value |
|-------|-------|
| Max auto-expand depth | 4 |
| Max total nested items | 150 |
| Max hex payload size | 32 KB |
| Max user-expand depth | 12 |
| Concurrent decode tasks | 5 |

`processAutoExpand()` uses a worker pool (`runWithConcurrencyLimit`) with in-flight deduplication via WeakSet.

### Value Formatting & UI

`formatValue(value, type, paramId)` renders each decoded value as HTML:

- **Addresses** → clickable links to `/address/{addr}`
- **Booleans** → `true`/`false` text
- **Strings** → URL detection (http, https, ipfs), linkified, expandable
- **Numbers** → formatted with commas, unit conversion dropdown (Wei → Gwei → ETH → 10^6), live BigInt math
- **Bytes (calldata-like)** → nested "Decode" button with depth tracking
- **Bytes (raw ABI)** → "ABI Decode" button
- **bytes32** → fixed hex with copy button (never treated as nested calldata)
- **Arrays/Tuples** → recursive HTML with indentation, type badges per element

`createDecodedUI()` builds the output matching Etherscan's row layout: `col-md-3` label + `col-md-9` content, with function signature and selector badges.

### Input View Auto-Switch

On page load, the extension tries to auto-select the "Original" view for the calldata input field (some explorers default to "Decoded" or "Default" which strips the raw hex). Tracks whether the user manually changes this and stops overriding if so. May log a CSP warning on some explorers due to inline `onclick` handlers.

---

## Contract Info Panel (`etherscan_contract_info.js`)

- Fetches the page HTML with `#code` fragment
- Finds the `#editor` code element
- Extracts multi-line comment block after `pragma solidity` (preferred) or everything before pragma (fallback)
- Strips comment markers (`/* */`, `*`, `//`), SPDX lines, submitted URLs
- Parses `label: value` format, detects and linkifies URLs
- Renders in a fixed left-side panel (400px, dark theme, 80vh scrollable)

---

## QOL Buttons (`qol_buttons.js`)

Three independent features:

### Auto-Select 100 Rows
- Finds the records-per-page dropdown
- Selects the 100 option and dispatches a change event

### Incoming / CA Create Filter Buttons
Two injection strategies based on explorer:

- **Dropdown method** (BaseScan, BlastScan): finds the CSV export button, reuses existing dropdown links with `f=3` (incoming) and `f=5` (contract creation)
- **URL navigation method** (others): creates buttons that navigate to `/txs?a={address}&f=3` or `&f=5`

### Funded Tx Copy Buttons
- Detects "Funded By" containers via heuristic (has address copy button + address link + tx link)
- Clones the address copy button template, wires it to copy the tx hash
- Click handler: copies to clipboard, toggles icon (fa-copy → fa-check → fa-copy)
- Retries every 100ms for up to 5 seconds (elements may load asynchronously)

All features use MutationObserver for SPA re-triggers on URL changes.

---

## Ad Removal (`remove_from_page_qol.js`)

Runs at `document_start` (before layout paint) for zero-flicker removal:

- **Featured banner rule:** removes `section.container-xxl` elements containing Revive ad markers (`data-revive-id`, `xuv.etherscan.com`)
- **Sponsored dropdown rule:** removes `div.d-flex` containers where all children are sponsored dropdowns (detected by "Sponsored" label + `goto.*` advertiser redirect links)
- MutationObserver catches dynamically injected ads

---

## Styling (`styles.css`)

Dark theme matching Etherscan's color scheme. Key patterns:

- **Panel:** fixed positioning, flex column, scrollable body, collapse animation
- **Selectors:** section headers (blue dividers), per-row hover, orange highlight for non-standard functions, "query" badge for no-arg reads
- **Query results:** green/red backgrounds for success/error, unit dropdown, format toggle (Dec/Hex/Auto), tuple entries with type-colored badges
- **Collapsed state:** hides metadata (args, mutability, query dropdown, impl notice), compact fonts (11px)
- **Decoded calldata:** reuses Etherscan's Bootstrap grid, type badges, indented nested params
