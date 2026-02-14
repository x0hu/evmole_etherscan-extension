import { functionSelectors, functionArguments, functionStateMutability } from 'https://cdn.jsdelivr.net/npm/evmole@0.5.1/dist/evmole.mjs';

// Proxy storage slots
const PROXY_SLOTS = {
  EIP1967_IMPL: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  EIP1967_BEACON: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  EIP1822_LOGIC: '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
  ZEPPELIN_IMPL: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
};

// EIP-1167 minimal proxy pattern
const MINIMAL_PROXY_REGEX = /^0x363d3d373d3d3d363d73([a-fA-F0-9]{40})5af43d82803e903d91602b57fd5bf3$/;
const PROXY_SELECTOR_THRESHOLD = 8;
const SAFE_PROXY_RUNTIME_EXACT = '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033';
const SAFE_FALLBACK_FUNCTIONS = [
  { selector: '0xa0e67e2b', args: '()', mutability: 'view', signature: 'getOwners()' },
  { selector: '0xe75235b8', args: '()', mutability: 'view', signature: 'getThreshold()' },
  { selector: '0xaffed0e0', args: '()', mutability: 'view', signature: 'nonce()' },
  { selector: '0xa619486e', args: '()', mutability: 'view', signature: 'masterCopy()' },
  { selector: '0xffa1ad74', args: '()', mutability: 'view', signature: 'VERSION()' },
];

const CHAIN_CONFIG = {
  // Testnets (check first - more specific hostnames)
  'sepolia.etherscan.io': { rpcs: ['https://ethereum-sepolia.gateway.tatum.io', 'https://gateway.tenderly.co/public/sepolia', 'https://ethereum-sepolia-rpc.publicnode.com'] },
  'sepolia.basescan.org': { rpcs: ['https://base-sepolia.gateway.tenderly.co', 'https://base-sepolia.drpc.org', 'https://base-sepolia-rpc.publicnode.com'] },
  'testnet.monadscan.com': { rpcs: ['https://testnet-rpc.monad.xyz'] },
  // Mainnets
  'etherscan.io': { rpcs: ['https://eth.llamarpc.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'] },
  'basescan.org': { rpcs: [
    'https://base-rpc.publicnode.com',
    'https://base.lava.build',
    'https://base.drpc.org',
    'https://base.public.blockpi.network/v1/rpc/public',
    'https://base-public.nodies.app',
    'https://gateway.tenderly.co/public/base',
    'https://base.rpc.blxrbdn.com',
    'https://base.api.pocket.network',
    'https://api-base-mainnet-archive.n.dwellir.com/2ccf18bf-2916-4198-8856-42172854353c',
    'https://mainnet.base.org',
    'https://base-mainnet.gateway.tatum.io'
  ] },
  'arbiscan.io': { rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org', 'https://rpc.ankr.com/arbitrum'] },
  'optimistic.etherscan.io': { rpcs: ['https://mainnet.optimism.io', 'https://optimism.drpc.org', 'https://rpc.ankr.com/optimism'] },
  'polygonscan.com': { rpcs: ['https://polygon-rpc.com', 'https://polygon.drpc.org', 'https://rpc.ankr.com/polygon'] },
  'bscscan.com': { rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc.drpc.org', 'https://rpc.ankr.com/bsc'] },
  'blastscan.io': { rpcs: ['https://rpc.blast.io', 'https://blast.drpc.org'] },
  'sonicscan.org': { rpcs: ['https://rpc.soniclabs.com'] },
  'lineascan.build': { rpcs: ['https://rpc.linea.build', 'https://linea.drpc.org'] },
  'scrollscan.com': { rpcs: ['https://rpc.scroll.io', 'https://scroll.drpc.org'] },
  'era.zksync.network': { rpcs: ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org'] },
  'berascan.com': { rpcs: ['https://rpc.berachain.com'] },
  'mantlescan.xyz': { rpcs: ['https://rpc.mantle.xyz', 'https://mantle.drpc.org'] },
  'snowtrace.io': { rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.drpc.org'] },
  'snowscan.xyz': { rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche.drpc.org'] },
  'uniscan.xyz': { rpcs: ['https://mainnet.unichain.org'] },
  'worldscan.org': { rpcs: ['https://worldchain-mainnet.g.alchemy.com/public'] },
  'apescan.io': { rpcs: ['https://rpc.apechain.com/http'] },
  'abscan.org': { rpcs: ['https://api.mainnet.abs.xyz'] },
  'monadscan.com': { rpcs: ['https://rpc.monad.xyz'] },
};

const QUERY_HEDGE_STAGGER_MS = 180;
const QUERY_HEDGE_MAX_RPCS = 3;
const RPC_COOLDOWN_429_MS = 2 * 60 * 1000;
const RPC_COOLDOWN_403_MS = 10 * 60 * 1000;
const RPC_COOLDOWN_NETWORK_MS = 30 * 1000;
const rpcCooldownUntil = new Map();

function getChainConfig() {
  const host = window.location.hostname;
  // Exact match first (for subdomains like sepolia.etherscan.io)
  if (CHAIN_CONFIG[host]) {
    return CHAIN_CONFIG[host];
  }
  // Partial match fallback
  for (const [domain, config] of Object.entries(CHAIN_CONFIG)) {
    const stripped = domain.replace(/\.(io|org|com|xyz|network|build)$/, '');
    if (host.includes(stripped)) {
      return config;
    }
  }
  return CHAIN_CONFIG['etherscan.io'];
}

function getContractAddress() {
  const match = window.location.pathname.match(/\/(?:address|token)\/(0x[a-fA-F0-9]{40})/);
  return match ? match[1] : null;
}

function getCandidateRpcs(maxRpcs = QUERY_HEDGE_MAX_RPCS) {
  const now = Date.now();
  const configured = getChainConfig().rpcs;
  const healthy = configured.filter(rpc => (rpcCooldownUntil.get(rpc) || 0) <= now);
  const pool = healthy.length > 0 ? healthy : configured;
  return pool.slice(0, Math.max(1, maxRpcs));
}

function maybeCooldownRpc(rpc, error) {
  const msg = formatRpcError(error);
  if (!msg || msg.includes('AbortError') || msg.includes('Cancelled')) return;

  let cooldownMs = 0;
  if (/HTTP 429|Too Many Requests|rate limit/i.test(msg)) {
    cooldownMs = RPC_COOLDOWN_429_MS;
  } else if (/HTTP 403|Forbidden/i.test(msg)) {
    cooldownMs = RPC_COOLDOWN_403_MS;
  } else if (/Failed to fetch|NetworkError|Load failed|timeout|CORS/i.test(msg)) {
    cooldownMs = RPC_COOLDOWN_NETWORK_MS;
  }

  if (cooldownMs > 0) {
    rpcCooldownUntil.set(rpc, Date.now() + cooldownMs);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatSelectorDetail({ selector, args, mutability, signature }) {
  return `${selector}: ${args} ${mutability}\n    ${signature}`;
}

function isSafeProxyRuntimeBytecode(bytecode) {
  if (!bytecode || typeof bytecode !== 'string' || !bytecode.startsWith('0x')) return false;
  const normalized = bytecode.toLowerCase();

  if (normalized === SAFE_PROXY_RUNTIME_EXACT) {
    return true;
  }

  // Match core SafeProxy runtime behavior even if metadata tail differs.
  const hasMasterCopySelectorGate = normalized.includes('7fa619486e00000000000000000000000000000000000000000000000000000000');
  const hasSlotZeroLoad = normalized.includes('73ffffffffffffffffffffffffffffffffffffffff60005416');
  const hasDelegateFallback = normalized.includes('3660008037600080366000845af43d6000803e6000811415');
  return hasMasterCopySelectorGate && hasSlotZeroLoad && hasDelegateFallback;
}

function formatRpcError(error) {
  if (!error) return 'Unknown RPC error';
  if (typeof error === 'string') return error;
  if (error.name === 'AbortError') return 'Request aborted';
  return error.message || String(error);
}

async function rawRpcRequest(rpc, method, params, signal) {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now() + Math.floor(Math.random() * 1000),
      method,
      params
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message || 'JSON-RPC error');
  }

  if (!Object.prototype.hasOwnProperty.call(payload || {}, 'result')) {
    throw new Error(`Invalid ${method} result`);
  }

  return payload.result;
}

async function hedgedRpcRequest(method, params, { maxRpcs = QUERY_HEDGE_MAX_RPCS, staggerMs = QUERY_HEDGE_STAGGER_MS } = {}) {
  const rpcs = getCandidateRpcs(maxRpcs);
  if (rpcs.length === 0) {
    throw new Error('No RPC endpoints configured');
  }

  let settled = false;
  const controllers = [];

  try {
    const attempts = rpcs.map((rpc, index) => (async () => {
      if (index > 0) {
        await delay(staggerMs * index);
      }

      if (settled) {
        throw new Error('Cancelled');
      }

      const controller = new AbortController();
      controllers.push(controller);

      try {
        const result = await rawRpcRequest(rpc, method, params, controller.signal);
        return { result, rpc };
      } catch (err) {
        maybeCooldownRpc(rpc, err);
        throw err;
      }
    })());

    const winner = await Promise.any(attempts);
    settled = true;

    // Abort in-flight slower requests once the first valid result wins.
    controllers.forEach(controller => controller.abort());
    return winner;
  } catch (e) {
    const details = e instanceof AggregateError
      ? e.errors.map(formatRpcError).join('; ')
      : formatRpcError(e);
    throw new Error(`All RPCs failed: ${details}`);
  } finally {
    settled = true;
    controllers.forEach(controller => controller.abort());
  }
}

async function hedgedReadCall(contractAddress, selector, { allowEmpty = false, maxRpcs, staggerMs } = {}) {
  const winner = await hedgedRpcRequest(
    'eth_call',
    [{ to: contractAddress, data: selector }, 'latest'],
    { maxRpcs, staggerMs }
  );
  const data = winner.result;
  if (typeof data !== 'string' || !data.startsWith('0x')) {
    throw new Error('Invalid eth_call result');
  }
  if (!allowEmpty && data === '0x') {
    throw new Error(`Empty response from ${winner.rpc}`);
  }
  return { data, rpc: winner.rpc };
}

async function hedgedGetCode(address, { maxRpcs = 2, staggerMs = 120 } = {}) {
  const winner = await hedgedRpcRequest('eth_getCode', [address, 'latest'], { maxRpcs, staggerMs });
  const code = winner.result;
  if (typeof code !== 'string' || !code.startsWith('0x')) {
    throw new Error('Invalid eth_getCode result');
  }
  return { code, rpc: winner.rpc };
}

async function hedgedGetStorageAt(address, slot, { maxRpcs = 2, staggerMs = 120 } = {}) {
  const winner = await hedgedRpcRequest('eth_getStorageAt', [address, slot, 'latest'], { maxRpcs, staggerMs });
  const value = winner.result;
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    throw new Error('Invalid eth_getStorageAt result');
  }
  return { value, rpc: winner.rpc };
}

async function detectProxyImplementation(address, bytecode) {
  const ZERO_ADDR = '0x' + '0'.repeat(40);

  // 1. Check EIP-1167 minimal proxy (bytecode pattern) - instant, no RPC
  const match = bytecode.match(MINIMAL_PROXY_REGEX);
  if (match) {
    const impl = '0x' + match[1];
    console.log('EIP-1167 minimal proxy detected, impl:', impl);
    return impl;
  }

  // 2. Skip RPC checks if bytecode is very large (definitely not a proxy)
  // EIP-1967 transparent proxies can be 2000-6000 chars, real contracts are typically 10000+
  if (bytecode.length > 10000) {
    console.log('Very large bytecode, skipping proxy RPC checks');
    return null;
  }

  // 3. Check storage slots in parallel
  const slotChecks = Object.entries(PROXY_SLOTS).map(async ([name, slot]) => {
    try {
      const { value } = await hedgedGetStorageAt(address, slot);
      if (value && value !== '0x' + '0'.repeat(64)) {
        const impl = '0x' + value.slice(-40);
        if (impl !== ZERO_ADDR) {
          return { name, impl };
        }
      }
    } catch (e) {}
    return null;
  });

  // 4. Check custom pattern: impl stored at slot = contract address
  const selfSlotCheck = (async () => {
    try {
      const { value } = await hedgedGetStorageAt(address, address);
      if (value && value !== '0x' + '0'.repeat(64)) {
        const impl = '0x' + value.slice(-40);
        if (impl !== ZERO_ADDR) {
          return { name: 'SELF_SLOT', impl };
        }
      }
    } catch (e) {}
    return null;
  })();

  // Also check implementation() call in parallel
  const implCallCheck = (async () => {
    try {
      const { data } = await hedgedReadCall(address, '0x5c60da1b', { allowEmpty: true }); // implementation()
      if (data && data !== '0x' && data.length >= 66) {
        const impl = '0x' + data.slice(-40);
        if (impl !== ZERO_ADDR) {
          return { name: 'implementation()', impl };
        }
      }
    } catch (e) {}
    return null;
  })();

  const results = await Promise.all([...slotChecks, selfSlotCheck, implCallCheck]);
  const found = results.find(r => r !== null);

  if (found) {
    console.log(`${found.name} proxy detected, impl:`, found.impl);
    return found.impl;
  }

  return null;
}

async function getImplementationBytecode(address, proxyBytecode) {
  const implAddress = await detectProxyImplementation(address, proxyBytecode);
  if (!implAddress) return null;

  try {
    const { code: implBytecode } = await hedgedGetCode(implAddress);
    if (implBytecode && implBytecode !== '0x') {
      return { address: implAddress, bytecode: implBytecode };
    }
  } catch (e) {
    console.log('Failed to fetch implementation bytecode:', e.message);
  }
  return null;
}

function decodeSingleWordResult(hexData, fnName) {
  const chunk = hexData.slice(2);
  if (chunk.length !== 64) return hexData;

  const name = fnName.toLowerCase();
  const value = BigInt('0x' + chunk);
  const isBoolHint = name.startsWith('is') || name.startsWith('has') || name === 'paused';
  if (isBoolHint) {
    return value === 0n ? 'false' : 'true';
  }

  // ABI-encoded address is left-padded to 32 bytes (12 leading zero bytes).
  const isAddressShaped = chunk.startsWith('0'.repeat(24)) && value !== 0n;
  const strongAddressNameHint = ['owner', 'admin', 'implementation', 'beacon'].includes(name)
    || name.includes('address')
    || name.includes('owner')
    || name.includes('admin')
    || name.includes('manager')
    || name.includes('factory')
    || name.includes('router')
    || name.includes('vault')
    || name.includes('treasury')
    || name.includes('governor')
    || name.includes('operator')
    || name.includes('controller')
    || name.includes('recipient')
    || name.includes('receiver');
  if (isAddressShaped && strongAddressNameHint) {
    return '0x' + chunk.slice(24);
  }

  return value.toString();
}

function decodeStringResult(hexData) {
  if (!hexData || !hexData.startsWith('0x') || hexData.length < 130) return null;
  const data = hexData.slice(2);
  const offset = BigInt('0x' + data.slice(0, 64));
  if (offset !== 32n) return null;
  const len = Number(BigInt('0x' + data.slice(64, 128)));
  const byteStart = 128;
  const byteEnd = byteStart + len * 2;
  if (len <= 0 || byteEnd > data.length) return null;
  const bytesHex = data.slice(byteStart, byteEnd);
  const bytes = new Uint8Array(bytesHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  try {
    const decoded = new TextDecoder().decode(bytes);
    // Avoid misclassifying non-string dynamic ABI data (e.g. address[] with null bytes) as string.
    if (!decoded || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

function decodeAddressArrayResult(hexData) {
  if (!hexData || !hexData.startsWith('0x') || hexData.length < 130) return null;
  const data = hexData.slice(2);
  if (data.length % 64 !== 0) return null;

  const offset = BigInt('0x' + data.slice(0, 64));
  if (offset !== 32n) return null;

  const len = Number(BigInt('0x' + data.slice(64, 128)));
  if (!Number.isFinite(len) || len < 0 || len > 1024) return null;

  const requiredChars = 128 + len * 64;
  if (data.length < requiredChars) return null;

  const values = [];
  for (let i = 0; i < len; i++) {
    const start = 128 + i * 64;
    const word = data.slice(start, start + 64);
    if (!word.startsWith('0'.repeat(24))) return null;
    values.push('0x' + word.slice(24));
  }
  return values;
}

async function queryReadFunction(selector, signature, contractAddress) {
  const fnName = signature.split('(')[0];
  const lowerFnName = fnName.toLowerCase();

  // Do raw call first to check response length
  try {
    const rawResult = await hedgedReadCall(contractAddress, selector);

    if (!rawResult.data || rawResult.data === '0x') {
      return { success: false, error: 'Empty response' };
    }

    const dataLen = (rawResult.data.length - 2) / 2; // bytes length

    if (lowerFnName === 'getowners') {
      const owners = decodeAddressArrayResult(rawResult.data);
      if (owners) {
        return { success: true, result: owners.length ? owners.join(', ') : '[]' };
      }
    }

    const stringResult = decodeStringResult(rawResult.data);
    if (stringResult !== null) {
      return { success: true, result: stringResult };
    }

    // Multiple 32-byte chunks = tuple, decode all
    if (dataLen > 32 && dataLen % 32 === 0) {
      const decoded = decodeTupleResult(rawResult.data);
      if (decoded) {
        return { success: true, result: decoded.formatted, rawChunks: decoded.chunks };
      }
    }

    if (dataLen === 32) {
      return { success: true, result: decodeSingleWordResult(rawResult.data, fnName) };
    }

    // Fallback to raw hex
    return { success: true, result: rawResult.data };
  } catch (e) {
    return { success: false, error: e.message || 'Query failed' };
  }
}

function decodeTupleResult(hexData) {
  // Remove 0x prefix
  const data = hexData.slice(2);
  if (data.length === 0 || data.length % 64 !== 0) return null;

  const chunks = [];
  for (let i = 0; i < data.length; i += 64) {
    chunks.push(data.slice(i, i + 64));
  }

  // Decode each 32-byte chunk as decimal (default)
  const results = chunks.map(chunk => {
    const value = BigInt('0x' + chunk);

    const isLikelyAddress = chunk.startsWith('000000000000000000000000')
      && value > BigInt('0xffffffffffffffff')
      && value < BigInt('0xffffffffffffffffffffffffffffffffffffffff');

    if (isLikelyAddress) {
      return '0x' + chunk.slice(24);
    }

    return value.toString();
  });

  return { formatted: results.join(', '), chunks };
}

function formatTupleChunks(chunks, mode) {
  if (mode === 'hex') {
    return chunks.map(c => '0x' + c).join(', ');
  }
  if (mode === 'auto') {
    return autoDecodeTuple(chunks);
  }
  // dec (default)
  return chunks.map(chunk => {
    const value = BigInt('0x' + chunk);
    const isLikelyAddress = chunk.startsWith('000000000000000000000000')
      && value > BigInt('0xffffffffffffffff')
      && value < BigInt('0xffffffffffffffffffffffffffffffffffffffff');
    if (isLikelyAddress) return '0x' + chunk.slice(24);
    return value.toString();
  }).join(', ');
}

function autoDecodeTuple(chunks) {
  const totalBytes = chunks.length * 32;
  const consumed = new Set(); // chunk indices that are part of string length+data
  const offsetMap = new Map(); // chunk index → decoded string

  // Pass 1: find offsets pointing to ABI-encoded strings
  for (let i = 0; i < chunks.length; i++) {
    const val = Number(BigInt('0x' + chunks[i]));
    if (val === 0 || val % 32 !== 0 || val >= totalBytes) continue;
    const target = val / 32;
    if (target <= i || target >= chunks.length) continue;
    // target chunk = string length
    const strLen = Number(BigInt('0x' + chunks[target]));
    if (strLen <= 0 || strLen > totalBytes) continue;
    const dataChunks = Math.ceil(strLen / 32);
    if (target + dataChunks >= chunks.length) continue;
    // try decoding as UTF-8
    const hex = chunks.slice(target + 1, target + 1 + dataChunks).join('').slice(0, strLen * 2);
    if (hex.length < strLen * 2) continue;
    const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
    try {
      const str = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!/^[\x20-\x7e\n\r\t]+$/.test(str)) continue; // not printable ASCII
      offsetMap.set(i, str);
      consumed.add(target);
      for (let j = target + 1; j <= target + dataChunks; j++) consumed.add(j);
    } catch (e) { /* not valid UTF-8 */ }
  }

  // Pass 2: build structured entries
  const entries = [];
  let idx = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (consumed.has(i)) continue;
    if (offsetMap.has(i)) {
      entries.push({ idx: idx++, type: 'str', value: offsetMap.get(i) });
      continue;
    }
    const chunk = chunks[i];
    const value = BigInt('0x' + chunk);
    if (chunk === '0'.repeat(63) + '0' || chunk === '0'.repeat(63) + '1') {
      entries.push({ idx: idx++, type: 'bool', value: value === 0n ? 'false' : 'true' });
      continue;
    }
    if (chunk.startsWith('000000000000000000000000') && value > BigInt('0xffffffffffffffff')) {
      entries.push({ idx: idx++, type: 'addr', value: '0x' + chunk.slice(24) });
      continue;
    }
    const usedBytes = Math.ceil(chunk.replace(/^0+/, '').length / 2);
    if (usedBytes <= 8) {
      entries.push({ idx: idx++, type: 'uint', value: value.toString() });
    } else {
      entries.push({ idx: idx++, type: 'bytes', value: '0x' + chunk });
    }
  }
  return entries;
}

window.addEventListener('message', async (event) => {
  if (event.data?.type === 'QUERY_READ_FUNCTION') {
    const { selector, signature, contractAddress } = event.data;
    const result = await queryReadFunction(selector, signature, contractAddress);
    window.postMessage({
      type: 'QUERY_RESULT',
      selector,
      ...result
    }, '*');
  }
  if (event.data?.type === 'FORMAT_TUPLE') {
    const { selector, chunks, mode } = event.data;
    const formatted = formatTupleChunks(chunks, mode);
    window.postMessage({
      type: 'FORMAT_TUPLE_RESULT',
      selector,
      mode,
      formatted
    }, '*');
  }
});

async function fetchSignatures(selectors) {
  if (!selectors || selectors.length === 0) {
    return {};
  }
  const formattedSelectors = selectors.map(selector =>
    selector.startsWith('0x') ? selector : `0x${selector}`
  );
  const url = 'https://api.openchain.xyz/signature-database/v1/lookup?filter=true&function=' + formattedSelectors.join(',');
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log('Signature lookup failed:', response.status);
      return {};
    }
    const data = await response.json();
    // Defensive: check data, result, and function all exist
    if (data && data.result && data.result.function) {
      return data.result.function;
    }
    return {};
  } catch (e) {
    console.log('Signature lookup error:', e);
    return {};
  }
}

function getBytecodeFromHTML() {
  // Get all pre elements with wordwrap class (excluding ace editors which contain source code)
  let bytecodeElements = [
    ...document.querySelectorAll('pre.wordwrap.scrollbar-custom'),
    ...document.querySelectorAll('pre.wordwrap')
  ].filter(el => {
    if (el.classList.contains('ace_editor')) return false;
    if (el.id && el.id.startsWith('editor')) return false;
    return true;
  });

  // First pass: find Deployed Bytecode (direct text content, no child divs)
  for (let element of bytecodeElements) {
    if (element.querySelector('#verifiedbytecode2')) continue;
    const text = element.textContent.trim();
    if (text.startsWith('0x') && text.length > 100) {
      return text;
    }
  }

  // Second pass: fall back to Creation Code
  const verifiedBytecode = document.querySelector('#verifiedbytecode2');
  if (verifiedBytecode) {
    const text = verifiedBytecode.textContent.trim();
    if (text.startsWith('0x') && text.length > 100) {
      return text;
    }
  }

  // Last fallback: unverified contracts
  for (let element of bytecodeElements) {
    const text = element.textContent.trim();
    if (text.startsWith('0x') && text.length > 100) {
      return text;
    }
  }

  return null;
}

async function extractFunctions() {
  try {
    const contractAddress = getContractAddress();
    if (!contractAddress) {
      console.log('No contract address found');
      window.postMessage({ type: 'FUNCTION_SELECTORS_RESULT', selectors: [], error: 'No contract address' }, '*');
      return;
    }

    // 1. Try HTML first
    let code = getBytecodeFromHTML();
    let bytecodeSource = 'html';

    // 2. If HTML fails, fetch via RPC
    if (!code) {
      console.log('No bytecode in HTML, fetching via RPC...');
      try {
        const fetched = await hedgedGetCode(contractAddress, { maxRpcs: 3, staggerMs: 100 });
        code = fetched.code;
        if (code && code !== '0x') {
          bytecodeSource = 'rpc';
          console.log('Bytecode fetched via RPC, length:', code.length, 'rpc:', fetched.rpc);
        } else {
          console.log('No bytecode found via RPC');
          window.postMessage({ type: 'FUNCTION_SELECTORS_RESULT', selectors: [], error: 'No bytecode found' }, '*');
          return;
        }
      } catch (e) {
        console.log('RPC fetch failed:', e.message);
        window.postMessage({ type: 'FUNCTION_SELECTORS_RESULT', selectors: [], error: 'RPC failed: ' + e.message }, '*');
        return;
      }
    } else {
      console.log('Bytecode found in HTML, length:', code.length);
    }

    // Check if it's actually bytecode
    if (!code.startsWith('0x')) {
      console.log('Source code detected, compilation not implemented');
      window.postMessage({ type: 'FUNCTION_SELECTORS_RESULT', selectors: [], error: 'Source code compilation not implemented' }, '*');
      return;
    }

    // 3. Fast path: if bytecode already exposes enough selectors, skip proxy RPC checks
    let implInfo = null;
    let bytecodeToAnalyze = code;
    const initialSelectors = functionSelectors(code);
    const isSafeRuntime = isSafeProxyRuntimeBytecode(code);

    if (initialSelectors.length === 0 && isSafeRuntime) {
      console.log('Safe proxy runtime fingerprint matched, skipping proxy RPC detection');
      const finalSelectors = SAFE_FALLBACK_FUNCTIONS.map(formatSelectorDetail);
      window.postMessage({
        type: 'FUNCTION_SELECTORS_RESULT',
        selectors: finalSelectors,
        implementationAddress: null,
        bytecodeSource
      }, '*');
      return;
    }

    if (initialSelectors.length >= PROXY_SELECTOR_THRESHOLD) {
      console.log('Skipping proxy detection (selector count >= threshold):', initialSelectors.length);
    } else {
      console.log('Checking for proxy implementation...');
      implInfo = await getImplementationBytecode(contractAddress, code);
      if (implInfo) {
        console.log('Proxy detected! Implementation:', implInfo.address);
        bytecodeToAnalyze = implInfo.bytecode;
      } else {
        console.log('Not a proxy or proxy detection failed');
      }
    }

    // 4. Extract and display functions
    console.log('Extracting function selectors from bytecode length:', bytecodeToAnalyze.length);
    const selectors = bytecodeToAnalyze === code ? initialSelectors : functionSelectors(bytecodeToAnalyze);
    console.log('Found', selectors.length, 'selectors');

    const signatures = await fetchSignatures(selectors);

    const selectorsWithDetails = await Promise.all(selectors.map(async (selector) => {
      const args = functionArguments(bytecodeToAnalyze, selector);
      const mutability = functionStateMutability(bytecodeToAnalyze, selector);
      const formattedSelector = selector.startsWith('0x') ? selector : `0x${selector}`;
      const signatureInfo = signatures[formattedSelector] && signatures[formattedSelector][0]
        ? signatures[formattedSelector][0].name
        : 'Unknown';
      return `${formattedSelector}: (${args}) ${mutability}\n    ${signatureInfo}`;
    }));

    let finalSelectors = selectorsWithDetails;
    if (finalSelectors.length === 0 && isSafeRuntime) {
      console.log('Safe proxy runtime fingerprint matched, using fallback read selectors');
      finalSelectors = SAFE_FALLBACK_FUNCTIONS.map(formatSelectorDetail);
    }

    console.log('Selectors:', finalSelectors);
    window.postMessage({
      type: 'FUNCTION_SELECTORS_RESULT',
      selectors: finalSelectors,
      implementationAddress: implInfo?.address || null,
      bytecodeSource
    }, '*');
  } catch (e) {
    console.error('extractFunctions error:', e);
    window.postMessage({ type: 'FUNCTION_SELECTORS_RESULT', selectors: [], error: e.message }, '*');
  }
}

// Run the function
extractFunctions();
