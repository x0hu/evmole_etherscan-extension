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

  const DEFAULT_SETTINGS = {
    contractFunctionsDefaultCollapsed: true
  };

  function getExtensionSettings() {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      chrome.storage.sync.get(DEFAULT_SETTINGS, settings => {
        if (chrome.runtime.lastError) {
          resolve({ ...DEFAULT_SETTINGS });
          return;
        }

        resolve(settings);
      });
    });
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
    if (hostname === 'wikipedia.org' || hostname.endsWith('.wikipedia.org')) return true;

    if (hostname === 'ethereum.org') {
      return /^\/(?:[a-z-]+\/)?developers\/docs\//.test(pathname);
    }

    if (hostname === 'github.com') {
      const referenceGithubPathPrefixes = [
        '/ethereum/eips',
        '/ethereum/solidity',
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
  
  function setPanelCollapsedState(panel, tab, collapsed) {
    panel.classList.toggle('collapsed', collapsed);
    tab.textContent = collapsed ? '\u25C0 Contract Functions' : 'Contract Functions \u25B6';

    panel.querySelectorAll('.function-name').forEach(el => {
      if (!el.dataset.full) el.dataset.full = el.textContent;
      el.textContent = collapsed ? el.dataset.full.replace(/\(.*\)/, '()') : el.dataset.full;
    });
  }

  function createRightPanel(content, { defaultCollapsed = true } = {}) {
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
    panel.className = defaultCollapsed ? 'evmole-panel collapsed' : 'evmole-panel';

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
    tab.textContent = defaultCollapsed ? '\u25C0 Contract Functions' : 'Contract Functions \u25B6';
    tab.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      setPanelCollapsedState(panel, tab, collapsed);
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

  async function displayFunctionSelectors() {
    // Check if relevant elements exist before creating the panel
    const editorElement = document.querySelector('#editor');

    if (!hasBytecodeCandidateOnPage() && !hasContractCodeCandidateOnPage() && !editorElement) {
      console.log('No relevant elements found. Panel will not be displayed.');
      return;
    }

    const settings = await getExtensionSettings();
    const panel = createRightPanel('<div id="selectors">Loading...</div>', {
      defaultCollapsed: settings.contractFunctionsDefaultCollapsed
    });
    
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

    function splitTopLevelAbiTypes(input) {
      const value = String(input || '').trim();
      if (!value || value === '()') return [];

      let inner = value;
      if (inner.startsWith('(') && inner.endsWith(')')) {
        let depth = 0;
        let wraps = true;
        for (let i = 0; i < inner.length; i++) {
          if (inner[i] === '(') depth++;
          if (inner[i] === ')') depth--;
          if (depth === 0 && i < inner.length - 1) {
            wraps = false;
            break;
          }
        }
        if (wraps) inner = inner.slice(1, -1);
      }

      const types = [];
      let depth = 0;
      let current = '';
      for (const char of inner) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === ',' && depth === 0) {
          types.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) types.push(current.trim());
      return types;
    }

    function normalizeAbiType(type) {
      let base = String(type || '').trim();
      if (!base) return null;

      const arrays = [];
      while (base.endsWith(']')) {
        const start = base.lastIndexOf('[');
        if (start === -1) return null;
        const size = base.slice(start + 1, -1);
        if (size !== '' && !/^\d+$/.test(size)) return null;
        arrays.unshift(size === '' ? '[]' : `[${size}]`);
        base = base.slice(0, start);
      }

      let normalizedBase;
      if (base.startsWith('(') && base.endsWith(')')) {
        const components = splitTopLevelAbiTypes(base).map(normalizeAbiType);
        if (components.some(component => !component)) return null;
        normalizedBase = `(${components.join(',')})`;
      } else if (base === 'address' || base === 'bool' || base === 'string' || base === 'bytes') {
        normalizedBase = base;
      } else if (/^bytes([1-9]|[12][0-9]|3[0-2])$/.test(base)) {
        normalizedBase = base;
      } else if (/^uint([0-9]+)?$/.test(base) || /^int([0-9]+)?$/.test(base)) {
        const bits = Number(base.replace(/^(u?int)/, '')) || 256;
        if (bits < 8 || bits > 256 || bits % 8 !== 0) return null;
        normalizedBase = base.startsWith('uint') ? `uint${bits}` : `int${bits}`;
      } else {
        return null;
      }

      return normalizedBase + arrays.join('');
    }

    function isCompositeAbiInput(type) {
      return type.includes('[') || type.startsWith('(');
    }

    function isUintAbiInput(type) {
      return /^uint(?:[0-9]+)?$/.test(type);
    }

    function getInputPlaceholder(type) {
      if (type === 'address') return '0x...';
      if (type === 'bool') return 'true';
      if (type.startsWith('uint') || type.startsWith('int')) return '123';
      if (type === 'bytes' || /^bytes\d+$/.test(type)) return '0x...';
      if (type === 'string') return 'text';
      if (type.includes('[')) return '["value1","value2"]';
      if (type.startsWith('(')) return '["value1","value2"]';
      return 'value';
    }

    function decimalToScaledInteger(value, decimals) {
      const trimmed = String(value || '').trim();
      if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
        throw new Error('Invalid decimal');
      }

      const [whole, fraction = ''] = trimmed.split('.');
      if (fraction.length > decimals) {
        throw new Error(`Too many decimal places for 10^${decimals}`);
      }

      const scaled = whole + fraction.padEnd(decimals, '0');
      return (BigInt(scaled || '0')).toString();
    }

    function normalizeUintInputValue(value) {
      const trimmed = String(value || '').trim();
      if (!/^(?:0x[a-fA-F0-9]+|\d+)$/.test(trimmed)) {
        throw new Error('Invalid integer');
      }
      return trimmed;
    }

    function multiplyUintInputValue(input, decimals) {
      input.value = decimalToScaledInteger(input.value, decimals);
    }

    function getCheapInputError(type, value) {
      const trimmed = String(value || '').trim();
      if (!trimmed) return 'Required';
      if (type === 'address' && !/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return 'Invalid address';
      if (type === 'bool' && !/^(true|false|1|0)$/i.test(trimmed)) return 'Invalid bool';
      if (isUintAbiInput(type)) {
        try {
          normalizeUintInputValue(trimmed);
        } catch (e) {
          return e.message || 'Invalid integer';
        }
      } else if (type.startsWith('int') && !/^-?(?:0x[a-fA-F0-9]+|\d+)$/.test(trimmed)) {
        return 'Invalid integer';
      }
      if ((type === 'bytes' || /^bytes\d+$/.test(type)) && (!/^0x[a-fA-F0-9]*$/.test(trimmed) || trimmed.length % 2 !== 0)) return 'Invalid hex';
      if (isCompositeAbiInput(type)) {
        try {
          if (!Array.isArray(JSON.parse(trimmed))) return 'Must be a JSON array';
        } catch (e) {
          return 'Invalid JSON';
        }
      }
      return '';
    }

    function renderUintInputUnitControl() {
      return `<div class="unit-dropdown param-unit-dropdown">
        <button type="button" class="link-secondary unit-toggle param-unit-toggle" title="Multiply input" aria-label="Multiply input"><i class="fas fa-exchange-alt fa-fw"></i></button>
        <div class="unit-menu param-unit-menu">
          <button type="button" data-decimals="6" class="unit-option param-unit-option">x 10⁶</button>
          <button type="button" data-decimals="9" class="unit-option param-unit-option">x 10⁹</button>
          <button type="button" data-decimals="18" class="unit-option param-unit-option">x 10¹⁸</button>
        </div>
      </div>`;
    }

    function renderParameterizedInputs(paramTypes) {
      return `<div class="query-param-list">${paramTypes.map((type, index) => `
        <label class="query-param-field">
          <span class="query-param-label">${escapeHtml(type)}</span>
          <span class="query-param-control">
            <input class="query-param-input" type="text" data-param-index="${index}" data-param-type="${escapeHtml(type)}" placeholder="${escapeHtml(getInputPlaceholder(type))}" spellcheck="false">
            ${isUintAbiInput(type) ? renderUintInputUnitControl() : ''}
          </span>
        </label>
      `).join('')}</div>`;
    }

    function collectParameterizedInputs(item) {
      const inputs = Array.from(item.querySelectorAll('.query-param-input'));
      return inputs.map(input => {
        const value = input.value.trim();
        if (isUintAbiInput(input.dataset.paramType)) {
          return normalizeUintInputValue(value);
        }
        return value;
      });
    }

    function updateParameterizedQueryState(item) {
      const button = item.querySelector('.query-btn.parameterized');
      if (!button) return;

      const inputs = Array.from(item.querySelectorAll('.query-param-input'));
      const firstError = inputs.map(input => getCheapInputError(input.dataset.paramType, input.value)).find(Boolean);
      button.disabled = Boolean(firstError);
      button.title = firstError || 'Query';
    }

    function isLikelyLinkReadFunction(signature) {
      const fnName = String(signature || '').split('(')[0].toLowerCase();
      const linkFunctionNames = new Set([
        'baseuri',
        'contracturi',
        'context',
        'data',
        'externalurl',
        'external_url',
        'image',
        'imageuri',
        'alldata',
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
        fnName.endsWith('data') ||
        fnName.includes('context') ||
        fnName.includes('uri') ||
        fnName.includes('url') ||
        fnName.includes('ipfs');
    }

    function queueReadFunctionLinkScan() {
      const candidates = Array.from(panel.querySelectorAll('.selector-item.queryable:not(.parameterized-queryable)'))
        .filter(item => {
          const selector = item.dataset.selector;
          const signature = item.dataset.signature;
          return selector && signature && !linkScanRequestedSelectors.has(selector);
        })
        .sort((a, b) => Number(isLikelyLinkReadFunction(b.dataset.signature)) - Number(isLikelyLinkReadFunction(a.dataset.signature)));

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
        }, 250 + (index * 250));
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

            const isReadFunction = mutability === 'view' || mutability === 'pure';
            const normalizedParamTypes = splitTopLevelAbiTypes(args).map(normalizeAbiType);
            const hasParseableParams = normalizedParamTypes.length > 0 && normalizedParamTypes.every(Boolean);
            const isNoArgRead = isReadFunction && args === '()' && functionName !== 'Unknown';
            const isParameterizedRead = isReadFunction && hasParseableParams && functionName !== 'Unknown';
            const queryableClass = isNoArgRead
              ? 'queryable'
              : (isParameterizedRead ? 'queryable parameterized-queryable' : '');

            const queryIndicator = isNoArgRead
              ? '<span class="queryable-indicator">query</span>'
              : (isParameterizedRead ? '<span class="queryable-indicator parameterized">query</span>' : '');
            const queryDropdown = isNoArgRead ? `<div class="query-dropdown" style="display:none;">
                  <button class="query-btn">Query</button>
                  <div class="query-result"></div>
                </div>` : (isParameterizedRead ? `<div class="query-dropdown parameterized-query-dropdown" style="display:none;">
                  ${renderParameterizedInputs(normalizedParamTypes)}
                  <button class="query-btn parameterized" disabled>Query</button>
                  <div class="query-result"></div>
                </div>` : '');

            const itemHtml = `
              <div class="selector-item ${highlightClass} ${queryableClass}"
                   data-selector="${selectorId}"
                   data-signature="${functionName}"
                   data-queryable="${isNoArgRead || isParameterizedRead}"
                   data-param-types="${escapeHtml(JSON.stringify(normalizedParamTypes.filter(Boolean)))}">
                <div class="selector-info">
                  <span class="selector-id">${selectorId}</span>
                  <span class="arguments">${args}</span>
                  <span class="mutability">${mutability}</span>
                </div>
                <div class="function-info">
                  <span class="function-name">${functionName}</span>${queryIndicator}
                </div>
                ${queryDropdown}
              </div>
            `;

            if (isReadFunction) {
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
                dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
              });

              const queryBtn = item.querySelector('.query-btn');
              if (queryBtn) {
                queryBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  if (queryBtn.disabled) return;
                  const selector = item.dataset.selector;
                  const signature = item.dataset.signature;
                  const resultDiv = item.querySelector('.query-result');
                  const inputTypes = JSON.parse(item.dataset.paramTypes || '[]');
                  let inputValues;
                  try {
                    inputValues = collectParameterizedInputs(item);
                  } catch (err) {
                    resultDiv.className = 'query-result error';
                    resultDiv.textContent = err.message || 'Invalid input';
                    updateParameterizedQueryState(item);
                    return;
                  }
                  resultDiv.className = 'query-result loading';
                  resultDiv.textContent = 'Loading...';

                  window.postMessage({
                    type: 'QUERY_READ_FUNCTION',
                    selector,
                    signature,
                    contractAddress,
                    inputTypes,
                    inputValues
                  }, '*');
                });
              }

              item.querySelectorAll('.query-param-input').forEach(input => {
                input.addEventListener('click', e => e.stopPropagation());
                input.addEventListener('input', () => updateParameterizedQueryState(item));
              });
              item.querySelectorAll('.param-unit-dropdown').forEach(dropdown => {
                const toggle = dropdown.querySelector('.param-unit-toggle');
                const menu = dropdown.querySelector('.param-unit-menu');
                const input = dropdown.closest('.query-param-control')?.querySelector('.query-param-input');
                if (!toggle || !menu || !input) return;

                toggle.addEventListener('click', (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!input.value.trim()) {
                    input.focus();
                    updateParameterizedQueryState(item);
                    return;
                  }
                  panel.querySelectorAll('.param-unit-menu.show').forEach(openMenu => {
                    if (openMenu !== menu) openMenu.classList.remove('show');
                  });
                  menu.classList.toggle('show');
                });

                dropdown.querySelectorAll('.param-unit-option').forEach(option => {
                  option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const decimals = Number(option.dataset.decimals);
                    try {
                      multiplyUintInputValue(input, decimals);
                    } catch (err) {
                      const resultDiv = item.querySelector('.query-result');
                      if (resultDiv) {
                        resultDiv.className = 'query-result error';
                        resultDiv.textContent = err.message || 'Invalid input';
                      }
                      updateParameterizedQueryState(item);
                      return;
                    }
                    menu.classList.remove('show');
                    updateParameterizedQueryState(item);
                  });
                });
              });
              updateParameterizedQueryState(item);
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
        const { selector, success, result, error, rawChunks, purpose, linkScanValue } = event.data;
        if (success) {
          panel.addDiscoveredLinks?.(extractLinksFromResultValue(result));
          panel.addDiscoveredLinks?.(extractLinksFromResultValue(linkScanValue));
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
                  <button type="button" data-mode="dec" class="fmt-option">Dec</button>
                  <button type="button" data-mode="hex" class="fmt-option">Hex</button>
                  <button type="button" data-mode="auto" class="fmt-option active">Auto</button>
                </div>`;
            } else if (isNumeric) {
              controls = `
                <div class="unit-dropdown">
                  <button type="button" class="link-secondary unit-toggle" title="Convert units" aria-label="Convert units"><i class="fas fa-exchange-alt fa-fw"></i></button>
                  <div class="unit-menu">
                    <button type="button" data-unit="1" class="unit-option active">Wei</button>
                    <button type="button" data-unit="1e6" class="unit-option">/ 10⁶</button>
                    <button type="button" data-unit="1e9" class="unit-option">Gwei</button>
                    <button type="button" data-unit="1e18" class="unit-option">Ether</button>
                    <button type="button" data-unit="addr" class="unit-option">Address</button>
                  </div>
                </div>`;
            }

            const renderedValue = renderValueWithAddressLinks(result);
            resultDiv.innerHTML = `<span class="result-value">${renderedValue}</span>${controls}<button type="button" class="js-clipboard link-secondary" data-clipboard-text="${result}" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Copy" aria-label="Copy"><i id="${copyId}" class="far fa-copy fa-fw"></i></button>`;

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
