import { functionSelectors, functionArguments, functionStateMutability } from 'https://cdn.jsdelivr.net/npm/evmole@0.5.1/dist/evmole.mjs';

async function fetchSignatures(selectors) {
  const formattedSelectors = selectors.map(selector => 
    selector.startsWith('0x') ? selector : `0x${selector}`
  );
  const url = 'https://api.openchain.xyz/signature-database/v1/lookup?filter=true&function=' + formattedSelectors.join(',');
  const response = await fetch(url);
  const data = await response.json();
  return data.result.function;
}

async function extractFunctions() {
  // Get elements with both selectors
  let bytecodeElements = [
    ...document.querySelectorAll('pre.wordwrap.scrollbar-custom'),
    ...document.querySelectorAll('.wordwrap.scrollbar-custom')
  ];
  let bytecodeElement = null;

  // Find the element that contains the bytecode (starts with '0x')
  for (let element of bytecodeElements) {
    if (element.textContent.trim().startsWith('0x')) {
      bytecodeElement = element;
      break;
    }
  }
  
  // If still not found, try to get source code for verified contracts
  if (!bytecodeElement) {
    bytecodeElement = document.querySelector('#editor');
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