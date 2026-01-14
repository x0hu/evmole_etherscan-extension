function injectScript(file, node) {
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.setAttribute('src', chrome.runtime.getURL(file));
    node.appendChild(script);
  }
  
  function createRightPanel(content) {
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.top = '50%';
    panel.style.transform = 'translateY(-50%)';
    panel.style.width = '400px';
    panel.style.padding = '15px';
    panel.style.backgroundColor = 'rgba(28, 30, 33, 0.4)';
    panel.style.border = '1px solid #2d2f31';
    panel.style.borderRadius = '5px';
    panel.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    panel.style.zIndex = '1000';
    panel.style.maxHeight = '80vh';
    panel.style.overflowY = 'auto';
    panel.style.color = '#e4e6eb';
    panel.style.fontFamily = 'Monospace, monospace';
  
    const title = document.createElement('h3');
    title.textContent = 'Contract Functions';
    title.style.marginBottom = '10px';
    title.style.color = '#e4e6eb';
    panel.appendChild(title);
  
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = content;
    panel.appendChild(contentDiv);
  
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.style.position = 'absolute';
    closeButton.style.right = '10px';
    closeButton.style.top = '10px';
    closeButton.style.border = 'none';
    closeButton.style.background = 'none';
    closeButton.style.fontSize = '18px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.color = '#e4e6eb';
    closeButton.onclick = function() {
      document.body.removeChild(panel);
    };
    panel.appendChild(closeButton);
  
    document.body.appendChild(panel);
    return contentDiv;
  }
  
  function injectStyles(file) {
    const link = document.createElement('link');
    link.href = chrome.runtime.getURL(file);
    link.type = 'text/css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  function displayFunctionSelectors() {
    // Check if relevant elements exist before creating the panel
    const bytecodeElements = Array.from(document.querySelectorAll('pre.wordwrap.scrollbar-custom, .wordwrap.scrollbar-custom'));
    const editorElement = document.querySelector('#editor');

    if (bytecodeElements.length === 0 && !editorElement) {
      console.log('No relevant elements found. Panel will not be displayed.');
      return;
    }

    const panel = createRightPanel('<div id="selectors">Loading...</div>');
    
    injectScript('evmole-script.js', document.head || document.documentElement);
    injectStyles('styles.css');
    
    const standardERC20Functions = [
      'name()',
      'symbol()',
      'decimals()',
      'totalSupply()',
      'balanceOf(address)',
      'transfer(address,uint256)',
      'transferFrom(address,address,uint256)',
      'approve(address,uint256)',
      'allowance(address,address)',
      'owner()',
      'transferOwnership(address)',
      'renounceOwnership()',
      'rescueERC20(address,uint256)'
    ];

    const messageHandler = function(event) {
      if (event.data && event.data.type === 'FUNCTION_SELECTORS_RESULT') {
        if (event.data.selectors && Array.isArray(event.data.selectors) && event.data.selectors.length > 0) {
          const selectorsHtml = event.data.selectors.map(selector => {
            if (typeof selector !== 'string') return '';
            const [selectorInfo, signatureInfo] = selector.split('\n');
            if (!selectorInfo || !signatureInfo) return '';
            const [selectorId, argsAndMutability] = selectorInfo.split(': ');
            if (!selectorId || !argsAndMutability) return '';
            const [args, mutability] = argsAndMutability.split(' ');
            const functionName = signatureInfo.trim();
            
            const isNonStandard = !standardERC20Functions.includes(functionName);
            const highlightClass = isNonStandard ? 'highlight-non-standard' : '';

            return `
              <div class="selector-item ${highlightClass}">
                <div class="selector-info">
                  <span class="selector-id">${selectorId}</span>
                  <span class="arguments">${args}</span>
                  <span class="mutability">${mutability}</span>
                </div>
                <div class="function-info">
                  <span class="function-name">${functionName}</span>
                </div>
              </div>
            `;
          }).join('');

          if (panel && panel.parentNode) {
            panel.innerHTML = selectorsHtml;
          }
        } else if (panel && panel.parentNode) {
          panel.innerHTML = '<div>No function selectors found or source code compilation not implemented.</div>';
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // Cleanup function to remove the event listener when the panel is closed
    const cleanup = () => {
      window.removeEventListener('message', messageHandler);
    };

    // Add cleanup to the close button
    const closeButton = panel.querySelector('button');
    if (closeButton) {
      const originalOnClick = closeButton.onclick;
      closeButton.onclick = function() {
        if (typeof originalOnClick === 'function') {
          originalOnClick.call(this);
        }
        cleanup();
      };
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', displayFunctionSelectors);
  } else {
    displayFunctionSelectors();
  }
