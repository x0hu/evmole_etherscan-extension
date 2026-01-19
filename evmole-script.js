import { functionSelectors, functionArguments, functionStateMutability } from 'https://cdn.jsdelivr.net/npm/evmole@0.5.1/dist/evmole.mjs';
import { createPublicClient, http } from 'https://esm.sh/viem@2.21.0';

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

async function queryReadFunction(selector, signature, contractAddress) {
  const config = getChainConfig();
  const client = createPublicClient({
    transport: http(config.rpc),
  });

  const fnName = signature.split('(')[0];

  try {
    const result = await client.readContract({
      address: contractAddress,
      abi: [{
        type: 'function',
        name: fnName,
        inputs: [],
        outputs: [{ type: 'uint256' }],
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
    return data.result?.function || {};
  } catch (e) {
    console.log('Signature lookup error:', e);
    return {};
  }
}

async function extractFunctions() {
  // Get all pre elements with wordwrap class (excluding ace editors which contain source code)
  let bytecodeElements = [
    ...document.querySelectorAll('pre.wordwrap.scrollbar-custom'),
    ...document.querySelectorAll('pre.wordwrap')
  ].filter(el => {
    // Exclude ace editors (source code)
    if (el.classList.contains('ace_editor')) return false;
    if (el.id && el.id.startsWith('editor')) return false;
    return true;
  });

  let bytecodeElement = null;

  // First pass: find Deployed Bytecode (direct text content, no child divs)
  for (let element of bytecodeElements) {
    // Skip if bytecode is inside a child element (like #verifiedbytecode2 for creation code)
    if (element.querySelector('#verifiedbytecode2')) continue;

    const text = element.textContent.trim();
    if (text.startsWith('0x') && text.length > 100) {
      bytecodeElement = element;
      break;
    }
  }

  // Second pass: fall back to Creation Code if no Deployed Bytecode found
  if (!bytecodeElement) {
    const verifiedBytecode = document.querySelector('#verifiedbytecode2');
    if (verifiedBytecode) {
      const text = verifiedBytecode.textContent.trim();
      if (text.startsWith('0x') && text.length > 100) {
        bytecodeElement = verifiedBytecode;
      }
    }
  }

  // Last fallback: unverified contracts
  if (!bytecodeElement) {
    for (let element of bytecodeElements) {
      const text = element.textContent.trim();
      if (text.startsWith('0x') && text.length > 100) {
        bytecodeElement = element;
        break;
      }
    }
  }

  if (bytecodeElement) {
    const code = bytecodeElement.textContent.trim();
    console.log('Code starts with:', code.substring(0, 50));
    let selectors;

    // Check if it's bytecode (starts with 0x) or source code
    if (code.startsWith('0x')) {
      console.log('Bytecode detected');
      selectors = functionSelectors(code);
    } else {
      console.log('Source code detected, compilation not implemented');
      return;
    }

    const signatures = await fetchSignatures(selectors);

    const selectorsWithDetails = await Promise.all(selectors.map(async (selector) => {
      const args = functionArguments(code, selector);
      const mutability = functionStateMutability(code, selector);
      const formattedSelector = selector.startsWith('0x') ? selector : `0x${selector}`;
      const signatureInfo = signatures[formattedSelector] && signatures[formattedSelector][0] 
        ? signatures[formattedSelector][0].name 
        : 'Unknown';
      return `${formattedSelector}: (${args}) ${mutability}\n    ${signatureInfo}`;
    }));

    console.log('Selectors:', selectorsWithDetails);
    window.postMessage({ type: 'FUNCTION_SELECTORS_RESULT', selectors: selectorsWithDetails }, '*');
  } else {
    console.log('Neither bytecode nor source code found');
  }
}

// Run the function
extractFunctions();