import { functionSelectors, functionArguments, functionStateMutability } from 'https://cdn.jsdelivr.net/npm/evmole@0.5.1/dist/evmole.mjs';
import { createPublicClient, http } from 'https://esm.sh/viem@2.21.0';

// Proxy storage slots
const PROXY_SLOTS = {
  EIP1967_IMPL: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  EIP1967_BEACON: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  EIP1822_LOGIC: '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
  ZEPPELIN_IMPL: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
};

// EIP-1167 minimal proxy pattern
const MINIMAL_PROXY_REGEX = /^0x363d3d373d3d3d363d73([a-fA-F0-9]{40})5af43d82803e903d91602b57fd5bf3$/;

const CHAIN_CONFIG = {
  'etherscan.io': { rpc: 'https://eth.llamarpc.com' },
  'basescan.org': { rpc: 'https://mainnet.base.org' },
  'arbiscan.io': { rpc: 'https://arb1.arbitrum.io/rpc' },
  'optimistic.etherscan.io': { rpc: 'https://mainnet.optimism.io' },
  'polygonscan.com': { rpc: 'https://polygon-rpc.com' },
  'bscscan.com': { rpc: 'https://bsc-dataseed.binance.org' },
  'blastscan.io': { rpc: 'https://rpc.blast.io' },
  'sonicscan.org': { rpc: 'https://rpc.soniclabs.com' },
  'lineascan.build': { rpc: 'https://rpc.linea.build' },
  'scrollscan.com': { rpc: 'https://rpc.scroll.io' },
  'era.zksync.network': { rpc: 'https://mainnet.era.zksync.io' },
  'berascan.com': { rpc: 'https://rpc.berachain.com' },
  'mantlescan.xyz': { rpc: 'https://rpc.mantle.xyz' },
  'snowtrace.io': { rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  'snowscan.xyz': { rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  'uniscan.xyz': { rpc: 'https://mainnet.unichain.org' },
  'worldscan.org': { rpc: 'https://worldchain-mainnet.g.alchemy.com/public' },
  'apescan.io': { rpc: 'https://rpc.apechain.com/http' },
  'abscan.org': { rpc: 'https://api.mainnet.abs.xyz' },
  'monadexplorer.com': { rpc: 'https://testnet-rpc.monad.xyz' },
};

function getChainConfig() {
  const host = window.location.hostname;
  for (const [domain, config] of Object.entries(CHAIN_CONFIG)) {
    if (host.includes(domain.replace('.io', '').replace('.org', '').replace('.com', '').replace('.xyz', '').replace('.network', '').replace('.build', ''))) {
      return config;
    }
  }
  return CHAIN_CONFIG['etherscan.io'];
}

function getContractAddress() {
  const match = window.location.pathname.match(/\/address\/(0x[a-fA-F0-9]{40})/);
  return match ? match[1] : null;
}

function createClient() {
  const config = getChainConfig();
  return createPublicClient({ transport: http(config.rpc) });
}

async function detectProxyImplementation(client, address, bytecode) {
  const ZERO_ADDR = '0x' + '0'.repeat(40);

  // 1. Check EIP-1167 minimal proxy (bytecode pattern) - instant, no RPC
  const match = bytecode.match(MINIMAL_PROXY_REGEX);
  if (match) {
    const impl = '0x' + match[1];
    console.log('EIP-1167 minimal proxy detected, impl:', impl);
    return impl;
  }

  // 2. Skip RPC checks if bytecode is very large (definitely not a proxy)
  // EIP-1967 transparent proxies can be 2000-6000 chars, real contracts are 10000+
  if (bytecode.length > 15000) {
    console.log('Very large bytecode, skipping proxy RPC checks');
    return null;
  }

  // 3. Check storage slots in parallel
  const slotChecks = Object.entries(PROXY_SLOTS).map(async ([name, slot]) => {
    try {
      const value = await client.getStorageAt({ address, slot });
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
      const value = await client.getStorageAt({ address, slot: address });
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
      const result = await client.call({
        to: address,
        data: '0x5c60da1b', // implementation()
      });
      if (result.data && result.data !== '0x' && result.data.length >= 66) {
        const impl = '0x' + result.data.slice(-40);
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

async function getImplementationBytecode(client, address, proxyBytecode) {
  const implAddress = await detectProxyImplementation(client, address, proxyBytecode);
  if (!implAddress) return null;

  try {
    const implBytecode = await client.getCode({ address: implAddress });
    if (implBytecode && implBytecode !== '0x') {
      return { address: implAddress, bytecode: implBytecode };
    }
  } catch (e) {
    console.log('Failed to fetch implementation bytecode:', e.message);
  }
  return null;
}

function formatResult(result) {
  if (typeof result === 'bigint') {
    const hex = result.toString(16);
    // Only treat as address if hex is 38-40 chars (actual address-sized value)
    if (hex.length >= 38 && hex.length <= 40) {
      return '0x' + hex.padStart(40, '0');
    }
    return result.toString();
  }
  if (typeof result === 'string' && result.startsWith('0x')) {
    return result;
  }
  if (Array.isArray(result)) {
    return result.map(formatResult).join(', ');
  }
  if (typeof result === 'object' && result !== null) {
    return JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v);
  }
  return String(result);
}

function inferOutputType(fnName) {
  const name = fnName.toLowerCase();

  // String returns
  if (['name', 'symbol', 'version'].includes(name)) return 'string';
  if (name.endsWith('uri') || name.endsWith('url')) return 'string';

  // Address returns
  if (['owner', 'admin', 'implementation', 'beacon'].includes(name)) return 'address';
  if (name.includes('address') || name.includes('owner') || name.includes('admin')) return 'address';

  // Uint8 returns
  if (name === 'decimals') return 'uint8';

  // Bool returns
  if (name.startsWith('is') || name.startsWith('has') || name === 'paused') return 'bool';

  // Default to uint256
  return 'uint256';
}

async function queryReadFunction(selector, signature, contractAddress) {
  const config = getChainConfig();
  const client = createPublicClient({
    transport: http(config.rpc),
  });

  const fnName = signature.split('(')[0];
  const outputType = inferOutputType(fnName);

  try {
    const result = await client.readContract({
      address: contractAddress,
      abi: [{
        type: 'function',
        name: fnName,
        inputs: [],
        outputs: [{ type: outputType }],
        stateMutability: 'view',
      }],
      functionName: fnName,
    });
    return { success: true, result: formatResult(result) };
  } catch (e) {
    return { success: false, error: e.message || 'Query failed' };
  }
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
        const client = createClient();
        code = await client.getCode({ address: contractAddress });
        if (code && code !== '0x') {
          bytecodeSource = 'rpc';
          console.log('Bytecode fetched via RPC, length:', code.length);
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

    // 3. Check for proxy and get implementation bytecode
    const client = createClient();
    let implInfo = null;
    let bytecodeToAnalyze = code;

    console.log('Checking for proxy implementation...');
    implInfo = await getImplementationBytecode(client, contractAddress, code);
    if (implInfo) {
      console.log('Proxy detected! Implementation:', implInfo.address);
      bytecodeToAnalyze = implInfo.bytecode;
    } else {
      console.log('Not a proxy or proxy detection failed');
    }

    // 4. Extract and display functions
    console.log('Extracting function selectors from bytecode length:', bytecodeToAnalyze.length);
    const selectors = functionSelectors(bytecodeToAnalyze);
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

    console.log('Selectors:', selectorsWithDetails);
    window.postMessage({
      type: 'FUNCTION_SELECTORS_RESULT',
      selectors: selectorsWithDetails,
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