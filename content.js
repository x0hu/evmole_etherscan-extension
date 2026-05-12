function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectScript(file, node) {
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.setAttribute('src', chrome.runtime.getURL(file));
    node.appendChild(script);
  }

  function normalizeSourceUrl(rawUrl) {
    const normalized = String(rawUrl || '')
      .replace(/\\\//g, '/')
      .replace(/\u00a0/g, ' ')
      .trim();
    if (!normalized) return null;

    const { core } = splitTrailingUrlPunctuation(normalized);
    if (!/^https?:\/\//i.test(core)) return null;

    try {
      new URL(core);
      return core;
    } catch (e) {
      return null;
    }
  }

  function isReferenceSourceUrl(url) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return false;
    }

    const hostname = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();
    const referenceHosts = new Set([
      'cs.stackexchange.com',
      'blog.openzeppelin.com',
      'consensys.net',
      'datatracker.ietf.org',
      'docs.ethers.io',
      'docs.metamask.io',
      'docs.soliditylang.org',
      'developer.mozilla.org',
      'eips.ethereum.org',
      'eth.wiki',
      'ethereum.github.io',
      'forum.openzeppelin.com',
      'notes.ethereum.org',
      'rfc-editor.org',
      'solidity.readthedocs.io',
      'web3js.readthedocs.io',
      'w3.org',
      'xn--2-umb.com'
    ]);

    if (referenceHosts.has(hostname)) return true;

    if (hostname === 'github.com') {
      const referenceGithubPathPrefixes = [
        '/ethereum/eips',
        '/openzeppelin/openzeppelin-contracts',
        '/transmissions11/solmate',
        '/vectorized/solady',
        '/uniswap/permit2',
        '/brechtpd/base64'
      ];
      return referenceGithubPathPrefixes.some(prefix => pathname.startsWith(prefix));
    }

    if (hostname === 'etherscan.io') {
      return pathname.startsWith('/address/');
    }

    return false;
  }

  function normalizeDiscoveredLink(rawLink) {
    const normalized = String(rawLink || '')
      .replace(/\\\//g, '/')
      .replace(/\u00a0/g, ' ')
      .trim();
    if (!normalized) return null;

    if (/^https?:\/\//i.test(normalized)) {
      return normalizeSourceUrl(normalized);
    }

    if (/^ipfs:\/\//i.test(normalized)) {
      const { core } = splitTrailingUrlPunctuation(normalized);
      const rawIpfsPath = core.replace(/^ipfs:\/\//i, '').replace(/^\/+/, '').replace(/^ipfs\//i, '');
      const ipfsPath = rawIpfsPath.match(/^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/)?.[0] || '';
      const cid = ipfsPath.split(/[/?#]/)[0];
      const isValidCidLike = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[ky][a-z2-7]{20,})$/i.test(cid);
      return isValidCidLike ? `ipfs://${ipfsPath}` : null;
    }

    const cidMatch = normalized.match(/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[ky][a-z2-7]{20,})$/i);
    return cidMatch ? cidMatch[0] : null;
  }

  function addUniqueLinks(target, foundLinks) {
    foundLinks.forEach(rawLink => {
      const link = normalizeDiscoveredLink(rawLink);
      if (!link) return;
      if (/^https?:\/\//i.test(link) && isReferenceSourceUrl(link)) return;
      if (!target.includes(link)) target.push(link);
    });
  }

  function extractLinksFromText(text) {
    const normalizedText = String(text || '')
      .replace(/\\\//g, '/')
      .replace(/\u00a0/g, ' ')
      .replace(/(https?:\/\/|ipfs:\/\/)/gi, '\n$1');
    const tokenRegex = /https?:\/\/[^\s<>"'`*\\[\]]+|ipfs:\/\/[^\s<>"'`*\\[\]]+|\b(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[ky][a-z2-7]{20,})\b/gi;
    const links = [];
    let match;

    while ((match = tokenRegex.exec(normalizedText)) !== null) {
      addUniqueLinks(links, [match[0]]);
    }

    return links;
  }

  function getDiscoveredLinkHref(link) {
    if (/^ipfs:\/\//i.test(link)) {
      return toIpfsGatewayUrl(link) || link;
    }

    if (/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[ky][a-z2-7]{20,})$/i.test(link)) {
      return `https://ipfs.io/ipfs/${link}`;
    }

    return link;
  }

  function extractLinksFromResultValue(value) {
    if (Array.isArray(value)) {
      return value.flatMap(entry => extractLinksFromResultValue(entry?.value ?? entry));
    }

    if (value && typeof value === 'object') {
      return extractLinksFromText(JSON.stringify(value));
    }

    return extractLinksFromText(value);
  }

  function getContractSourceLinks() {
    const links = [];

    const sourceRoot = document.querySelector('#subcontract_sourcecode, #code, #dividcode') || document;
    const detectedLinks = Array.from(sourceRoot.querySelectorAll('.detected-link'))
      .map(el => normalizeDiscoveredLink(el.textContent))
      .filter(Boolean);
    addUniqueLinks(links, detectedLinks);

    if (links.length > 0) {
      return links;
    }

    const sourceLines = Array.from(sourceRoot.querySelectorAll('.view-line'))
      .map(line => line.textContent || '')
      .join('\n');
    addUniqueLinks(links, extractLinksFromText(sourceLines));

    if (links.length > 0) {
      return links;
    }

    const sourceTextSelectors = [
      '#subcontract_sourcecode',
      '[id^="editor-"]',
      '.editor-area',
      '.view-lines',
      '#code'
    ];
    const sourceText = Array.from(document.querySelectorAll(sourceTextSelectors.join(',')))
      .map(el => el.textContent || '')
      .join('\n');
    addUniqueLinks(links, extractLinksFromText(sourceText));

    if (links.length > 0) {
      return links;
    }

    const contractJsonScript = Array.from(document.scripts)
      .map(script => script.textContent || '')
      .find(text => text.includes('editor_contractJsonData'));
    if (contractJsonScript) {
      const match = contractJsonScript.match(/editor_contractJsonData\s*=\s*'([\s\S]*?)';/);
      if (match) {
        const unescapedJsonText = match[1]
          .replace(/\\\//g, '/')
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"');
        addUniqueLinks(links, extractLinksFromText(unescapedJsonText));
      }
    }

    return links;
  }

  function renderLinksPanelContent(links) {
    return `<h3>Links Found</h3>
      <div class="source-link-list">
        ${links.map(url => `
          <a class="source-link-item" href="${escapeHtml(getDiscoveredLinkHref(url))}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(url)}
          </a>
        `).join('')}
      </div>`;
  }

  function createLinksPanel(links) {
    const panel = document.createElement('div');
    panel.className = 'evmole-links-panel';
    panel.innerHTML = renderLinksPanelContent(links);
    panel.dataset.links = JSON.stringify(links);
    return panel;
  }
  
  function createRightPanel(content) {
    // Container: fixed on right edge, holds panel + tab
    const container = document.createElement('div');
    container.className = 'evmole-container';

    let linksPanel = null;
    const readFunctionLinks = [];

    const getAllLinks = () => {
      const links = getContractSourceLinks();
      addUniqueLinks(links, readFunctionLinks);
      return links;
    };

    const updateLinksPanel = () => {
      const links = getAllLinks();
      if (links.length === 0) return;

      const serializedLinks = JSON.stringify(links);
      if (linksPanel && linksPanel.dataset.links === serializedLinks) return;

      if (!linksPanel) {
        linksPanel = createLinksPanel(links);
        container.insertBefore(linksPanel, panel);
      } else {
        linksPanel.innerHTML = renderLinksPanelContent(links);
        linksPanel.dataset.links = serializedLinks;
      }
    };

    const addReadFunctionLinks = foundLinks => {
      const beforeCount = readFunctionLinks.length;
      addUniqueLinks(readFunctionLinks, foundLinks);
      if (readFunctionLinks.length !== beforeCount) {
        updateLinksPanel();
      }
    };

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
    contentDiv.addDiscoveredLinks = addReadFunctionLinks;
    contentDiv.refreshLinksPanel = updateLinksPanel;
    panel.appendChild(contentDiv);

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.className = 'evmole-close-btn';
    closeButton.onclick = function() {
      document.body.removeChild(container);
    };
    panel.appendChild(closeButton);

    container.appendChild(panel);
    updateLinksPanel();

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

    let linkRefreshCount = 0;
    const linkRefreshTimer = setInterval(() => {
      if (!document.body.contains(container) || linkRefreshCount >= 10) {
        clearInterval(linkRefreshTimer);
        return;
      }
      updateLinksPanel();
      linkRefreshCount += 1;
    }, 1000);

    const originalCloseClick = closeButton.onclick;
    closeButton.onclick = function() {
      clearInterval(linkRefreshTimer);
      originalCloseClick.call(this);
    };

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

  function hasBytecodeCandidateOnPage() {
    const bytecodeSelectors = [
      '#verifiedbytecode2',
      '#verifiedbytecode_convert222',
      '[id^="verifiedbytecode"]',
      'pre.text-wrap.scrollbar-custom',
      'pre.wordwrap.scrollbar-custom',
      'pre.wordwrap',
      'pre.scrollbar-custom'
    ];

    return Array.from(document.querySelectorAll(bytecodeSelectors.join(','))).some(el => {
      if (el.classList.contains('ace_editor')) return false;
      if (el.id && el.id.startsWith('editor')) return false;

      const compactText = (el.textContent || '').replace(/\s+/g, '').trim();
      return /0x[a-fA-F0-9]{100,}/.test(compactText) || /^[a-fA-F0-9]{100,}$/.test(compactText);
    });
  }

  function hasContractCodeCandidateOnPage() {
    if (!getContractAddress()) return false;

    const codeRoot = document.querySelector('#code, #contracts, #ContentPlaceHolder1_contractCodeDiv');
    if (!codeRoot) return false;

    const codeText = codeRoot.textContent || '';
    return /Contract Source Code|Minimal Proxy Contract|Read Contract as Proxy|Write Contract as Proxy/i.test(codeText) ||
      !!document.querySelector('#subcontract_sourcecode');
  }

  function splitTrailingUrlPunctuation(url) {
    let core = url;
    let trailing = '';
    while (core.length > 0) {
      const ch = core.slice(-1);
      if (!'.,;!?)]}'.includes(ch)) break;
      core = core.slice(0, -1);
      trailing = ch + trailing;
    }
    return { core, trailing };
  }

  function toIpfsGatewayUrl(uri) {
    const prefix = 'ipfs://';
    if (!uri || !uri.startsWith(prefix)) return null;
    let path = uri.slice(prefix.length).replace(/^\/+/, '');
    path = path.replace(/^ipfs\//i, '');
    if (!path) return null;
    return `https://ipfs.io/ipfs/${path}`;
  }

  function renderInlineLinks(value, { addressLinks = true } = {}) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const tokenRegex = /https?:\/\/[^\s<>"'`]+|ipfs:\/\/[^\s<>"'`]+|0x[a-fA-F0-9]{40}/g;
    let html = '';
    let last = 0;
    let match;

    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      html += escapeHtml(text.slice(last, match.index));

      if (token.startsWith('http://') || token.startsWith('https://')) {
        const { core, trailing } = splitTrailingUrlPunctuation(token);
        if (core) {
          html += `<a class="result-link" href="${escapeHtml(core)}" target="_blank" rel="noopener noreferrer">${escapeHtml(core)}</a>`;
        } else {
          html += escapeHtml(token);
        }
        if (trailing) html += escapeHtml(trailing);
      } else if (token.startsWith('ipfs://')) {
        const { core, trailing } = splitTrailingUrlPunctuation(token);
        const gatewayUrl = toIpfsGatewayUrl(core);
        if (gatewayUrl) {
          html += `<a class="result-link" href="${escapeHtml(gatewayUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(core)}</a>`;
        } else {
          html += escapeHtml(token);
        }
        if (trailing) html += escapeHtml(trailing);
      } else if (addressLinks) {
        html += `<a class="result-address-link" href="${getExplorerAddressUrl(token)}" target="_blank" rel="noopener noreferrer">${token}</a>`;
      } else {
        html += escapeHtml(token);
      }

      last = tokenRegex.lastIndex;
    }

    html += escapeHtml(text.slice(last));
    return html;
  }

  function renderValueWithAddressLinks(value) {
    return renderInlineLinks(value, { addressLinks: true });
  }

  function displayFunctionSelectors() {
    // Check if relevant elements exist before creating the panel
    const editorElement = document.querySelector('#editor');

    if (!hasBytecodeCandidateOnPage() && !hasContractCodeCandidateOnPage() && !editorElement) {
      console.log('No relevant elements found. Panel will not be displayed.');
      return;
    }

    const panel = createRightPanel('<div id="selectors">Loading...</div>');
    
    injectScript('evmole-script.js', document.head || document.documentElement);
    injectStyles('styles.css');
    
    const standardFunctionSignatures = [
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
      'rescueERC20(address,uint256)',
      'poolManager()',
      'beforeInitialize(address,(address,address,uint24,int24,address),uint160)',
      'afterInitialize(address,(address,address,uint24,int24,address),uint160,int24)',
      'beforeAddLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)',
      'afterAddLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),int256,int256,bytes)',
      'beforeRemoveLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)',
      'afterRemoveLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),int256,int256,bytes)',
      'beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)',
      'afterSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),int256,bytes)',
      'beforeDonate(address,(address,address,uint24,int24,address),uint256,uint256,bytes)',
      'afterDonate(address,(address,address,uint24,int24,address),uint256,uint256,bytes)'
    ];

    const standardFunctionSelectors = new Set([
      '0xdc4c90d3', // poolManager
      '0xdc98354e', // beforeInitialize
      '0x6fe7e6eb', // afterInitialize
      '0x259982e5', // beforeAddLiquidity
      '0x9f063efc', // afterAddLiquidity
      '0x21d0ee70', // beforeRemoveLiquidity
      '0x6c2bbe7e', // afterRemoveLiquidity
      '0x575e24b4', // beforeSwap
      '0xb47b2fb1', // afterSwap
      '0xb6a8b0fa', // beforeDonate
      '0xe1b4af69'  // afterDonate
    ]);

    const contractAddress = getContractAddress();
    const linkScanRequestedSelectors = new Set();

    function isLikelyLinkReadFunction(signature) {
      const fnName = String(signature || '').split('(')[0].toLowerCase();
      const linkFunctionNames = new Set([
        'baseuri',
        'contracturi',
        'externalurl',
        'external_url',
        'image',
        'imageuri',
        'metadata',
        'metadatauri',
        'tokenuri',
        'uri',
        'website',
        'web',
        'site',
        'telegram',
        'twitter',
        'x'
      ]);

      return linkFunctionNames.has(fnName) ||
        fnName.includes('uri') ||
        fnName.includes('url') ||
        fnName.includes('ipfs');
    }

    function queueReadFunctionLinkScan() {
      const candidates = Array.from(panel.querySelectorAll('.selector-item.queryable'))
        .filter(item => {
          const selector = item.dataset.selector;
          const signature = item.dataset.signature;
          if (!selector || !signature || linkScanRequestedSelectors.has(selector)) return false;
          return isLikelyLinkReadFunction(signature);
        })
        .slice(0, 8);

      candidates.forEach((item, index) => {
        linkScanRequestedSelectors.add(item.dataset.selector);
        setTimeout(() => {
          if (!panel.isConnected) return;
          window.postMessage({
            type: 'QUERY_READ_FUNCTION',
            purpose: 'LINK_SCAN',
            selector: item.dataset.selector,
            signature: item.dataset.signature,
            contractAddress
          }, '*');
        }, 600 + (index * 700));
      });
    }

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

            const isNonStandard = !standardFunctionSignatures.includes(functionName) &&
                                  !standardFunctionSelectors.has(selectorId.toLowerCase());
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

            queueReadFunctionLinkScan();
          }
        } else if (panel && panel.parentNode) {
          const errorMsg = event.data.error || 'No function selectors found';
          panel.innerHTML = `<div class="error-notice">${errorMsg}</div>`;
        }
      }

      // Handle query results
      if (event.data && event.data.type === 'QUERY_RESULT') {
        const { selector, success, result, error, rawChunks, purpose } = event.data;
        if (success) {
          panel.addDiscoveredLinks?.(extractLinksFromResultValue(result));
        }
        if (purpose === 'LINK_SCAN') return;

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
                  <a href="javascript:;" data-mode="dec" class="fmt-option">Dec</a>
                  <a href="javascript:;" data-mode="hex" class="fmt-option">Hex</a>
                  <a href="javascript:;" data-mode="auto" class="fmt-option active">Auto</a>
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

              // Default tuple display mode is Auto when available.
              window.postMessage({
                type: 'FORMAT_TUPLE',
                selector,
                chunks: rawChunks,
                mode: 'auto'
              }, '*');
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
            resultDiv.innerHTML = renderInlineLinks(error, { addressLinks: false });
          }
        }
      }

      // Handle tuple format toggle results
      if (event.data && event.data.type === 'FORMAT_TUPLE_RESULT') {
        const { selector, formatted, mode } = event.data;
        panel.addDiscoveredLinks?.(extractLinksFromResultValue(formatted));
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
              const hasInlineLink = /https?:\/\/[^\s<>"'`]+/.test(e.value) || /ipfs:\/\/[^\s<>"'`]+/.test(e.value) || /0x[a-fA-F0-9]{40}/.test(e.value);
              const isTrunc = e.type === 'str' && e.value.length > TRUNC && !hasInlineLink;
              let val;
              if (e.type === 'addr' && /^0x[a-fA-F0-9]{40}$/.test(e.value)) {
                val = `<a class="tuple-val result-address-link" href="${getExplorerAddressUrl(e.value)}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
              } else if (isTrunc) {
                val = `<span class="tuple-val truncated" data-full="${escaped}">${escapeHtml(e.value.slice(0, TRUNC))}…</span>`;
              } else if (e.type === 'str') {
                val = `<span class="tuple-val">${renderInlineLinks(e.value, { addressLinks: true })}</span>`;
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
