function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function injectScript(file, node) {
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.setAttribute('src', chrome.runtime.getURL(file));
    node.appendChild(script);
  }
  
  function createRightPanel(content) {
    // Container: fixed on right edge, holds panel + tab
    const container = document.createElement('div');
    container.className = 'evmole-container';

    // Panel (top)
    const panel = document.createElement('div');
    panel.className = 'evmole-panel collapsed';

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
    closeButton.className = 'evmole-close-btn';
    closeButton.onclick = function() {
      document.body.removeChild(container);
    };
    panel.appendChild(closeButton);

    container.appendChild(panel);

    // Bottom tab toggle
    const tab = document.createElement('div');
    tab.className = 'evmole-tab';
    tab.textContent = '\u25C0 Contract Functions';
    tab.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      tab.textContent = collapsed ? '\u25C0 Contract Functions' : 'Contract Functions \u25B6';
      // Strip/restore args in function names
      panel.querySelectorAll('.function-name').forEach(el => {
        if (collapsed) {
          if (!el.dataset.full) el.dataset.full = el.textContent;
          el.textContent = el.dataset.full.replace(/\(.*\)/, '()');
        } else if (el.dataset.full) {
          el.textContent = el.dataset.full;
        }
      });
    });
    container.appendChild(tab);

    document.body.appendChild(container);
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
    const match = window.location.pathname.match(/\/(?:address|token)\/(0x[a-fA-F0-9]{40})/);
    return match ? match[1] : null;
  }

  function getExplorerAddressUrl(address) {
    return `${window.location.origin}/address/${address}`;
  }

  function renderValueWithAddressLinks(value) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const escaped = escapeHtml(text);
    return escaped.replace(/0x[a-fA-F0-9]{40}/g, address =>
      `<a class="result-address-link" href="${getExplorerAddressUrl(address)}" target="_blank" rel="noopener noreferrer">${address}</a>`
    );
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

            const queryIndicator = isNoArgRead ? '<span class="queryable-indicator">query</span>' : '';

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
                  <span class="function-name">${functionName}</span>${queryIndicator}
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
                if (e.target.closest('.query-dropdown')) return;
                const dropdown = item.querySelector('.query-dropdown');
                if (dropdown.style.display === 'none') {
                  dropdown.style.display = 'block';
                }
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
            // If starting collapsed, strip args from function names
            if (panel.parentNode && panel.parentNode.querySelector('.evmole-panel.collapsed')) {
              panel.querySelectorAll('.function-name').forEach(el => {
                el.dataset.full = el.textContent;
                el.textContent = el.textContent.replace(/\(.*\)/, '()');
              });
            }
          }
        } else if (panel && panel.parentNode) {
          const errorMsg = event.data.error || 'No function selectors found';
          panel.innerHTML = `<div class="error-notice">${errorMsg}</div>`;
        }
      }

      // Handle query results
      if (event.data && event.data.type === 'QUERY_RESULT') {
        const { selector, success, result, error, rawChunks } = event.data;
        const item = panel.querySelector(`.selector-item[data-selector="${selector}"]`);
        if (item) {
          const resultDiv = item.querySelector('.query-result');
          if (success) {
            resultDiv.className = 'query-result success';
            const copyId = 'copyIcon_' + selector.replace('0x', '');
            const isTuple = rawChunks && rawChunks.length > 0;
            const isNumeric = !isTuple && !result.startsWith('0x') && /^\d+$/.test(result);

            let controls = '';
            if (isTuple) {
              controls = `
                <div class="format-toggle">
                  <a href="javascript:;" data-mode="dec" class="fmt-option active">Dec</a>
                  <a href="javascript:;" data-mode="hex" class="fmt-option">Hex</a>
                  <a href="javascript:;" data-mode="auto" class="fmt-option">Auto</a>
                </div>`;
            } else if (isNumeric) {
              controls = `
                <div class="unit-dropdown">
                  <a class="link-secondary unit-toggle" href="javascript:;" title="Convert units"><i class="fas fa-exchange-alt fa-fw"></i></a>
                  <div class="unit-menu">
                    <a href="javascript:;" data-unit="1" class="unit-option active">Wei</a>
                    <a href="javascript:;" data-unit="1e6" class="unit-option">/ 10⁶</a>
                    <a href="javascript:;" data-unit="1e9" class="unit-option">Gwei</a>
                    <a href="javascript:;" data-unit="1e18" class="unit-option">Ether</a>
                    <a href="javascript:;" data-unit="addr" class="unit-option">Address</a>
                  </div>
                </div>`;
            }

            const renderedValue = renderValueWithAddressLinks(result);
            resultDiv.innerHTML = `<span class="result-value">${renderedValue}</span>${controls}<a class="js-clipboard link-secondary" href="javascript:;" data-clipboard-text="${result}" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Copy"><i id="${copyId}" class="far fa-copy fa-fw"></i></a>`;

            // Tuple format toggle
            if (isTuple) {
              const valueSpan = resultDiv.querySelector('.result-value');
              resultDiv.querySelectorAll('.fmt-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  resultDiv.querySelectorAll('.fmt-option').forEach(o => o.classList.remove('active'));
                  opt.classList.add('active');
                  window.postMessage({
                    type: 'FORMAT_TUPLE',
                    selector,
                    chunks: rawChunks,
                    mode: opt.dataset.mode
                  }, '*');
                });
              });
            }

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
                  const unit = opt.dataset.unit;
                  let converted;
                  if (unit === 'addr') {
                    const mask160 = (1n << 160n) - 1n;
                    converted = '0x' + (rawValue & mask160).toString(16).padStart(40, '0');
                  } else {
                    const divisor = BigInt(parseFloat(unit));
                    converted = divisor === 1n ? rawValue.toString() : (Number(rawValue) / Number(divisor)).toString();
                  }
                  if (/^0x[a-fA-F0-9]{40}$/.test(converted)) {
                    valueSpan.innerHTML = renderValueWithAddressLinks(converted);
                  } else {
                    valueSpan.textContent = converted;
                  }
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

      // Handle tuple format toggle results
      if (event.data && event.data.type === 'FORMAT_TUPLE_RESULT') {
        const { selector, formatted, mode } = event.data;
        const item = panel.querySelector(`.selector-item[data-selector="${selector}"]`);
        if (item) {
          const resultDiv = item.querySelector('.query-result');
          const valueSpan = item.querySelector('.result-value');
          const clipboardBtn = item.querySelector('.js-clipboard');

          if (mode === 'auto' && Array.isArray(formatted)) {
            resultDiv.classList.add('auto-mode');
            const TRUNC = 60;
            const html = formatted.map(e => {
              const escaped = escapeHtml(e.value);
              const isTrunc = e.type === 'str' && e.value.length > TRUNC;
              let val;
              if (e.type === 'addr' && /^0x[a-fA-F0-9]{40}$/.test(e.value)) {
                val = `<a class="tuple-val result-address-link" href="${getExplorerAddressUrl(e.value)}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
              } else if (isTrunc) {
                val = `<span class="tuple-val truncated" data-full="${escaped}">${escapeHtml(e.value.slice(0, TRUNC))}…</span>`;
              } else {
                val = `<span class="tuple-val">${escaped}</span>`;
              }
              return `<div class="tuple-entry"><span class="tuple-idx">[${e.idx}]</span><span class="tuple-type type-${e.type}">${e.type}</span>${val}</div>`;
            }).join('');
            valueSpan.innerHTML = html;
            valueSpan.querySelectorAll('.truncated').forEach(el => {
              el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                el.textContent = el.dataset.full;
                el.classList.remove('truncated');
              });
            });
            const plain = formatted.map(e => `[${e.idx}] ${e.type}: ${e.value}`).join('\n');
            if (clipboardBtn) clipboardBtn.dataset.clipboardText = plain;
          } else {
            resultDiv.classList.remove('auto-mode');
            if (valueSpan) valueSpan.innerHTML = renderValueWithAddressLinks(formatted);
            if (clipboardBtn) clipboardBtn.dataset.clipboardText = formatted;
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
    const closeButton = panel.parentNode && panel.parentNode.querySelector('.evmole-close-btn');
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
