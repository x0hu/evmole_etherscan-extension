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

  function getContractAddress() {
    const match = window.location.pathname.match(/\/address\/(0x[a-fA-F0-9]{40})/);
    return match ? match[1] : null;
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

    const contractAddress = getContractAddress();

    const messageHandler = function(event) {
      if (event.data && event.data.type === 'FUNCTION_SELECTORS_RESULT') {
        if (event.data.selectors && Array.isArray(event.data.selectors) && event.data.selectors.length > 0) {
          const readFunctions = [];
          const writeFunctions = [];

          event.data.selectors.forEach(selector => {
            if (typeof selector !== 'string') return;
            const [selectorInfo, signatureInfo] = selector.split('\n');
            if (!selectorInfo || !signatureInfo) return;
            const [selectorId, argsAndMutability] = selectorInfo.split(': ');
            if (!selectorId || !argsAndMutability) return;
            const [args, mutability] = argsAndMutability.split(' ');
            const functionName = signatureInfo.trim();

            const isNonStandard = !standardERC20Functions.includes(functionName);
            const highlightClass = isNonStandard ? 'highlight-non-standard' : '';

            // Check if no-arg read function (queryable)
            const isNoArgRead = (mutability === 'view' || mutability === 'pure') &&
                                args === '()' &&
                                functionName !== 'Unknown';
            const queryableClass = isNoArgRead ? 'queryable' : '';

            const itemHtml = `
              <div class="selector-item ${highlightClass} ${queryableClass}"
                   data-selector="${selectorId}"
                   data-signature="${functionName}"
                   data-queryable="${isNoArgRead}">
                <div class="selector-info">
                  <span class="selector-id">${selectorId}</span>
                  <span class="arguments">${args}</span>
                  <span class="mutability">${mutability}</span>
                </div>
                <div class="function-info">
                  <span class="function-name">${functionName}</span>
                </div>
                ${isNoArgRead ? `<div class="query-dropdown" style="display:none;">
                  <button class="query-btn">Query</button>
                  <div class="query-result"></div>
                </div>` : ''}
              </div>
            `;

            if (mutability === 'view' || mutability === 'pure') {
              readFunctions.push(itemHtml);
            } else {
              writeFunctions.push(itemHtml);
            }
          });

          let selectorsHtml = '';

          // Show implementation address if proxy detected
          if (event.data.implementationAddress) {
            const implAddr = event.data.implementationAddress;
            const shortAddr = implAddr.slice(0, 6) + '...' + implAddr.slice(-4);
            selectorsHtml += `<div class="impl-notice">
              <span>📦 Proxy → </span>
              <a href="/address/${implAddr}" target="_blank" class="impl-link">${shortAddr}</a>
            </div>`;
          }

          if (readFunctions.length > 0) {
            selectorsHtml += `<div class="section-header">Read Functions</div>`;
            selectorsHtml += readFunctions.join('');
          }
          if (writeFunctions.length > 0) {
            if (readFunctions.length > 0) {
              selectorsHtml += `<div class="section-divider"></div>`;
            }
            selectorsHtml += `<div class="section-header write-section">Write Functions</div>`;
            selectorsHtml += writeFunctions.join('');
          }

          if (panel && panel.parentNode) {
            panel.innerHTML = selectorsHtml;

            // Add click handlers for queryable functions
            panel.querySelectorAll('.selector-item.queryable').forEach(item => {
              item.addEventListener('click', (e) => {
                if (e.target.classList.contains('query-btn')) return;
                const dropdown = item.querySelector('.query-dropdown');
                dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
              });

              const queryBtn = item.querySelector('.query-btn');
              if (queryBtn) {
                queryBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  const selector = item.dataset.selector;
                  const signature = item.dataset.signature;
                  const resultDiv = item.querySelector('.query-result');
                  resultDiv.className = 'query-result loading';
                  resultDiv.textContent = 'Loading...';

                  window.postMessage({
                    type: 'QUERY_READ_FUNCTION',
                    selector,
                    signature,
                    contractAddress
                  }, '*');
                });
              }
            });
          }
        } else if (panel && panel.parentNode) {
          const errorMsg = event.data.error || 'No function selectors found';
          panel.innerHTML = `<div class="error-notice">${errorMsg}</div>`;
        }
      }

      // Handle query results
      if (event.data && event.data.type === 'QUERY_RESULT') {
        const { selector, success, result, error } = event.data;
        const item = panel.querySelector(`.selector-item[data-selector="${selector}"]`);
        if (item) {
          const resultDiv = item.querySelector('.query-result');
          if (success) {
            resultDiv.className = 'query-result success';
            const copyId = 'copyIcon_' + selector.replace('0x', '');
            const isNumeric = !result.startsWith('0x') && /^\d+$/.test(result);

            let unitDropdown = '';
            if (isNumeric) {
              unitDropdown = `
                <div class="unit-dropdown">
                  <a class="link-secondary unit-toggle" href="javascript:;" title="Convert units"><i class="fas fa-exchange-alt fa-fw"></i></a>
                  <div class="unit-menu">
                    <a href="javascript:;" data-unit="1" class="unit-option active">Wei</a>
                    <a href="javascript:;" data-unit="1e6" class="unit-option">/ 10⁶</a>
                    <a href="javascript:;" data-unit="1e9" class="unit-option">Gwei</a>
                    <a href="javascript:;" data-unit="1e18" class="unit-option">Ether</a>
                  </div>
                </div>`;
            }

            resultDiv.innerHTML = `<span class="result-value">${result}</span>${unitDropdown}<a class="js-clipboard link-secondary" href="javascript:;" data-clipboard-text="${result}" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Copy"><i id="${copyId}" class="far fa-copy fa-fw"></i></a>`;

            // Unit conversion
            if (isNumeric) {
              const rawValue = BigInt(result);
              const valueSpan = resultDiv.querySelector('.result-value');
              const dropdown = resultDiv.querySelector('.unit-dropdown');
              const toggle = dropdown.querySelector('.unit-toggle');
              const menu = dropdown.querySelector('.unit-menu');

              toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                menu.classList.toggle('show');
              });

              dropdown.querySelectorAll('.unit-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  dropdown.querySelectorAll('.unit-option').forEach(o => o.classList.remove('active'));
                  opt.classList.add('active');
                  const divisor = BigInt(parseFloat(opt.dataset.unit));
                  const converted = divisor === 1n ? rawValue.toString() : (Number(rawValue) / Number(divisor)).toString();
                  valueSpan.textContent = converted;
                  resultDiv.querySelector('.js-clipboard').dataset.clipboardText = converted;
                  menu.classList.remove('show');
                });
              });

              document.addEventListener('click', () => menu.classList.remove('show'), { once: false });
            }

            resultDiv.querySelector('.js-clipboard').addEventListener('click', (e) => {
              e.stopPropagation();
              e.preventDefault();
              navigator.clipboard.writeText(e.currentTarget.dataset.clipboardText);
              const icon = document.getElementById(copyId);
              icon.classList.remove('fa-copy');
              icon.classList.add('fa-check');
              setTimeout(() => {
                icon.classList.remove('fa-check');
                icon.classList.add('fa-copy');
              }, 1000);
            });
          } else {
            resultDiv.className = 'query-result error';
            resultDiv.textContent = error;
          }
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
