function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function injectScript(file, node, dataset = {}) {
    const script = document.createElement('script');
    script.setAttribute('type', 'module');
    script.setAttribute('src', chrome.runtime.getURL(file));
    Object.entries(dataset).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        script.dataset[key] = String(value);
      }
    });
    node.appendChild(script);
  }

  const DEFAULT_SETTINGS = {
    contractFunctionsDefaultCollapsed: true,
    signatureDatabaseUrl: '',
    signatureDatabaseStoreUnknowns: false,
    summaryProvider: 'openrouter',
    codexFastMode: false,
    codexReasoningEffort: 'low'
  };
  const OPENROUTER_SUMMARY_TYPE = 'EVMOLE_OPENROUTER_SUMMARY';
  const OPENROUTER_STATUS_TYPE = 'EVMOLE_OPENROUTER_STATUS';
  const OPENROUTER_CHAT_TYPE = 'EVMOLE_OPENROUTER_CHAT';
  const CODEX_SUMMARY_TYPE = 'EVMOLE_CODEX_SUMMARY';
  const CODEX_SELECTOR_NAMES_TYPE = 'EVMOLE_CODEX_SELECTOR_NAMES';
  const CODEX_CHAT_TYPE = 'EVMOLE_CODEX_CHAT';
  const CODEX_STATUS_TYPE = 'EVMOLE_CODEX_STATUS';
  const FETCH_TOKEN_URI_TYPE = 'EVMOLE_FETCH_TOKEN_URI';
  const CALL_CONTRACT_FUNCTION_TYPE = 'CALL_CONTRACT_FUNCTION';
  const CALL_CONTRACT_FUNCTION_RESULT_TYPE = 'CALL_CONTRACT_FUNCTION_RESULT';
  const SUMMARY_PROMPT_VERSION = 'evmole-contract-summary-v19-token-limit-facts';
  const SELECTOR_NAME_PROMPT_VERSION = 'evmole-selector-heuristic-v3';
  const SUMMARY_MODEL = 'deepseek/deepseek-v4-flash';
  const CODEX_SUMMARY_MODEL = 'gpt-5.5';
  const CODEX_SUMMARY_PRIORITY_MODEL = 'gpt-5.5:priority';
  const SUMMARY_CONTEXT_BUDGET_BYTES = 90000;
  const SUMMARY_READ_PURPOSE = 'SUMMARY_CONTEXT';
  const SELECTOR_NAME_READ_PURPOSE = 'SELECTOR_NAME_CONTEXT';
  const CHAT_TOOL_READ_PURPOSE = 'CHAT_TOOL_READ';
  const SUMMARY_MIN_AUTO_READ_LIMIT = 10;
  const SELECTOR_NAME_BYTECODE_CHAR_LIMIT = 80000;
  const SELECTOR_NAME_BATCH_SIZE = 40;
  const SELECTOR_NAME_RICH_BATCH_SIZE = 12;
  const SELECTOR_NAME_READ_EVIDENCE_LIMIT = 4;
  const SELECTOR_NAME_READ_TIMEOUT_MS = 3000;
  const SELECTOR_NAME_READ_STAGGER_MS = 100;
  const SUMMARY_MAX_AUTO_READ_LIMIT = 20;
  const SUMMARY_RELOAD_READ_LIMIT = 35;
  const SUMMARY_AUTO_READ_TIMEOUT_MS = 3000;
  const SUMMARY_RELOAD_READ_TIMEOUT_MS = 8000;
  const SUMMARY_AUTO_READ_STAGGER_MS = 100;
  const SUMMARY_RELOAD_READ_STAGGER_MS = 180;
  const RELATED_CONTRACTS_STORAGE_KEY = 'evmoleRelatedContractsByCreator';
  const RELATED_CONTRACTS_MAX_CREATORS = 50;
  const RELATED_CONTRACTS_MAX_PER_CREATOR = 12;
  const RELATED_CONTRACTS_CHAT_LIMIT = 5;
  const MENTIONED_CONTRACTS_CHAT_LIMIT = 3;
  const MENTIONED_CONTRACT_ANALYSIS_TIMEOUT_MS = 12000;
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

  function localStorageGet(defaults) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve({ ...defaults });
        return;
      }

      chrome.storage.local.get(defaults, values => {
        if (chrome.runtime.lastError) {
          resolve({ ...defaults });
          return;
        }
        resolve(values || { ...defaults });
      });
    });
  }

  function localStorageSet(values) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve();
        return;
      }

      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Could not save local data.'));
          return;
        }
        resolve();
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
      'docs.balancer.fi',
      'docs.ethers.io',
      'docs.metamask.io',
      'docs.openzeppelin.com',
      'docs.soliditylang.org',
      'developer.mozilla.org',
      'eips.ethereum.org',
      'eth.wiki',
      'ethereum.github.io',
      'forum.openzeppelin.com',
      'gnu.org',
      'notes.ethereum.org',
      'rfc-editor.org',
      'solidity.readthedocs.io',
      'token-cdn-domain',
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
        '/fei-protocol',
        '/morpho-org',
        '/openzeppelin',
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
    contentDiv.getAllDiscoveredLinks = getAllLinks;
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

  function createSummaryPanel(content) {
    const container = document.createElement('div');
    container.className = 'evmole-summary-container';

    const panel = document.createElement('div');
    panel.className = 'evmole-summary-panel';
    panel.innerHTML = content;

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    closeButton.className = 'evmole-summary-close-btn';
    closeButton.onclick = function() {
      document.body.removeChild(container);
    };
    panel.appendChild(closeButton);

    container.appendChild(panel);
    document.body.appendChild(container);
    return panel;
  }

  function createContractChatPanel() {
    const panel = document.createElement('div');
    panel.className = 'evmole-chat-panel';
    panel.innerHTML = `
      <div class="evmole-chat-size-zone">
        <button class="evmole-chat-size-toggle" type="button" title="Expand chat" aria-label="Expand chat" aria-pressed="false">↕</button>
      </div>
      <div class="evmole-chat-log" role="log" aria-live="polite">
        <div class="evmole-chat-empty">Ask about this contract.</div>
      </div>
      <div class="evmole-chat-mention-menu" role="listbox" aria-label="Related contracts"></div>
      <form class="evmole-chat-form">
        <input class="evmole-chat-input" type="text" placeholder="Ask about this contract..." autocomplete="off" spellcheck="false">
        <button class="evmole-chat-send" type="submit">Ask</button>
      </form>
    `;
    const sizeToggle = panel.querySelector('.evmole-chat-size-toggle');
    sizeToggle?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const tall = panel.classList.toggle('tall');
      sizeToggle.setAttribute('aria-pressed', tall ? 'true' : 'false');
      sizeToggle.setAttribute('aria-label', tall ? 'Collapse chat' : 'Expand chat');
      sizeToggle.setAttribute('title', tall ? 'Collapse chat' : 'Expand chat');
    });
    document.body.appendChild(panel);
    return panel;
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

  function extractAddressFromText(value) {
    const match = String(value || '').match(/0x[a-fA-F0-9]{40}/);
    return match ? match[0] : '';
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

  function getSignatureDatabaseBaseUrl(settings) {
    const rawUrl = String(settings?.signatureDatabaseUrl || '').trim();
    if (!rawUrl) return null;

    try {
      const url = new URL(rawUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return url.toString().replace(/\/$/, '');
    } catch (e) {
      return null;
    }
  }

  function parseJsonAbiText(text) {
    const raw = String(text || '').trim();
    if (!raw || !raw.startsWith('[')) return null;

    try {
      const abi = JSON.parse(raw);
      return Array.isArray(abi) && abi.some(entry => entry?.type === 'function')
        ? abi
        : null;
    } catch (e) {
      return null;
    }
  }

  function getVerifiedContractAbi() {
    const directAbi = parseJsonAbiText(document.getElementById('js-copytextarea2')?.textContent);
    if (directAbi) return directAbi;

    const candidates = Array.from(document.querySelectorAll('pre, textarea, code'));
    for (const candidate of candidates) {
      const abi = parseJsonAbiText(candidate.textContent || candidate.value);
      if (abi) return abi;
    }

    return null;
  }

  function abiTypeArraySuffix(type) {
    const match = String(type || '').match(/(\[[0-9]*\])*$/);
    return match ? match[0] : '';
  }

  function canonicalAbiInputType(input) {
    if (!input || typeof input !== 'object') return '';
    const rawType = String(input.type || '').trim();
    if (!rawType) return '';
    if (rawType.startsWith('tuple')) {
      const components = Array.isArray(input.components) ? input.components : [];
      return `(${components.map(canonicalAbiInputType).join(',')})${abiTypeArraySuffix(rawType)}`;
    }
    return rawType;
  }

  function canonicalAbiSignature(entry) {
    if (!entry || entry.type !== 'function' || !entry.name) return '';
    const inputs = Array.isArray(entry.inputs) ? entry.inputs : [];
    return `${entry.name}(${inputs.map(canonicalAbiInputType).join(',')})`;
  }

  function buildVerifiedFunctionMaps(verifiedFunctions) {
    const bySignature = new Map();
    const byNameAndInputs = new Map();
    (verifiedFunctions || []).forEach(entry => {
      const signature = canonicalAbiSignature(entry);
      if (!signature) return;
      const inputTypes = (entry.inputs || []).map(canonicalAbiInputType);
      const record = {
        ...entry,
        signature,
        inputTypes,
        inputNames: (entry.inputs || []).map((input, index) => String(input?.name || `arg${index}`).trim() || `arg${index}`),
        stateMutability: entry.stateMutability || ''
      };
      bySignature.set(signature, record);
      byNameAndInputs.set(`${entry.name.toLowerCase()}(${inputTypes.join(',')})`, record);
    });
    return { bySignature, byNameAndInputs };
  }

  async function postVerifiedAbiToSignatureDb(settings, contractAddress) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    if (!baseUrl || !contractAddress) return;

    const abi = getVerifiedContractAbi();
    if (!abi) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);

    try {
      await fetch(`${baseUrl}/abis/verified`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contractAddress,
          chainHost: window.location.hostname,
          pageUrl: window.location.href,
          abi
        })
      });
    } catch (e) {
      console.log('Signature DB verified ABI store error:', e?.message || e);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getContractInfoText() {
    const codeText = document.querySelector('#editor')?.textContent || '';
    if (!codeText) return '';

    const pragmaIndex = codeText.indexOf('pragma solidity');
    if (pragmaIndex !== -1) {
      const pragmaLineEnd = codeText.indexOf('\n', pragmaIndex);
      if (pragmaLineEnd !== -1) {
        const afterPragma = codeText.substring(pragmaLineEnd + 1);
        const commentStart = afterPragma.indexOf('/*');
        const commentEnd = commentStart === -1 ? -1 : afterPragma.indexOf('*/', commentStart);
        if (commentEnd !== -1) {
          return afterPragma.substring(commentStart, commentEnd + 2)
            .replace(/\/\*+|\*+\/|^\s*\*\s?/gm, '')
            .trim()
            .slice(0, 4000);
        }
      }

      return codeText.substring(0, pragmaIndex).trim().slice(0, 4000);
    }

    return '';
  }

  function extractAddressFromElement(element) {
    if (!element) return '';
    const attributes = ['data-clipboard-text', 'data-highlight-target', 'href', 'title', 'aria-label', 'data-bs-title', 'data-original-title'];
    const addressLink = element.matches?.('a[href*="/address/"]')
      ? element
      : element.querySelector?.('a[href*="/address/"]');
    const addressSources = [
      element,
      addressLink,
      ...Array.from(element.querySelectorAll?.('[href], [title], [aria-label], [data-bs-title], [data-original-title], [data-clipboard-text]') || [])
    ].filter(Boolean);

    for (const sourceElement of addressSources) {
      for (const attr of attributes) {
        const value = sourceElement.getAttribute?.(attr);
        const address = extractAddressFromText(value);
        if (address) return address;
      }
    }

    return extractAddressFromText(element.textContent || '');
  }

  function getContractCreatorInfo(root = document) {
    const creatorContainer = root.querySelector('#ContentPlaceHolder1_trContract');
    const creatorAddress = extractAddressFromElement(creatorContainer);
    if (creatorAddress) {
      return {
        label: 'Contract creator',
        address: creatorAddress,
        source: 'explorer'
      };
    }

    const candidates = Array.from(root.querySelectorAll('div, li, tr, section'))
      .filter(element => /contract\s+creator/i.test(element.textContent || ''))
      .slice(0, 8);
    for (const candidate of candidates) {
      const address = extractAddressFromElement(candidate);
      if (address) {
        return {
          label: 'Contract creator',
          address,
          source: 'explorer'
        };
      }
    }

    return null;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function chromeMessage(message) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve({
          ok: false,
          error: 'Extension runtime is unavailable. Reload this Etherscan page to reconnect Evmole.',
          contextInvalidated: true
        });
        return;
      }

      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message || 'Extension message failed.';
          const contextInvalidated = /extension context invalidated|context invalidated/i.test(error);
          resolve({
            ok: false,
            error: contextInvalidated ? 'Extension context invalidated. Reload this Etherscan page to reconnect Evmole.' : error,
            contextInvalidated
          });
          return;
        }

        resolve(response || { ok: false, error: 'No response from extension background worker.' });
      });
    });
  }

  async function fetchContractSummaryCache(settings, params) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    if (!baseUrl) return null;

    const url = new URL(`${baseUrl}/contract-summaries`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.summary || null;
    } catch (e) {
      console.log('Contract summary cache lookup error:', e?.message || e);
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getSelectorNameCacheModel(settings) {
    return settings?.codexFastMode ? CODEX_SUMMARY_PRIORITY_MODEL : CODEX_SUMMARY_MODEL;
  }

  function normalizeHeuristicName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const cleaned = raw
      .replace(/\([^)]*\)/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    if (!cleaned) return '';
    const withPrefix = /^[A-Za-z_]/.test(cleaned) ? cleaned : `fn_${cleaned}`;
    return /^[A-Za-z_][A-Za-z0-9_]{1,79}$/.test(withPrefix) ? withPrefix : '';
  }

  function normalizeSelectorCacheId(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    const selector = text.startsWith('0x') ? text : `0x${text}`;
    return /^0x[0-9a-f]{8}$/.test(selector) ? selector : '';
  }

  function normalizeAiSelectorNameEntry(entry) {
    const selector = normalizeSelectorCacheId(entry?.selector);
    const heuristicName = normalizeHeuristicName(entry?.heuristicName || entry?.heuristic_name || entry?.name);
    if (!selector || !heuristicName) return null;
    const confidence = ['high', 'medium', 'low'].includes(String(entry?.confidence || '').toLowerCase())
      ? String(entry.confidence).toLowerCase()
      : 'low';
    return {
      selector,
      heuristicName,
      confidence,
      reasoning: String(entry?.reasoning || '').trim().slice(0, 500),
      source: entry?.source === 'fallback' ? 'fallback' : 'codex'
    };
  }

  async function fetchAiSelectorNameCache(settings, params) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    if (!baseUrl || !params?.bytecodeHash || !params?.contractAddress) return new Map();

    const url = new URL(`${baseUrl}/ai-selector-names`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
    });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return new Map();
      const payload = await response.json();
      const entries = Array.isArray(payload?.names) ? payload.names : [];
      return entries.reduce((acc, entry) => {
        const normalized = normalizeAiSelectorNameEntry(entry);
        if (normalized) acc.set(normalized.selector, normalized);
        return acc;
      }, new Map());
    } catch (e) {
      console.log('AI selector name cache lookup error:', e?.message || e);
      return new Map();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function storeAiSelectorNameCache(settings, params, names) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    const normalizedNames = (names || []).map(normalizeAiSelectorNameEntry).filter(Boolean);
    if (!baseUrl || !params?.bytecodeHash || !params?.contractAddress || normalizedNames.length === 0) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`${baseUrl}/ai-selector-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...params,
          names: normalizedNames
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.log('AI selector name cache store failed:', response.status, payload?.error || response.statusText);
      }
    } catch (e) {
      console.log('AI selector name cache store error:', e?.message || e);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function fetchContractSummariesByCreator(settings, { chainHost, creatorAddress, excludeContractAddress, limit = 10 }) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    if (!baseUrl || !creatorAddress) return [];

    const url = new URL(`${baseUrl}/contract-summaries/by-creator`);
    url.searchParams.set('chainHost', chainHost || window.location.hostname);
    url.searchParams.set('creatorAddress', creatorAddress);
    if (excludeContractAddress) url.searchParams.set('excludeContractAddress', excludeContractAddress);
    url.searchParams.set('limit', String(limit));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload?.summaries) ? payload.summaries : [];
    } catch (e) {
      console.log('Related contract summary lookup error:', e?.message || e);
      return [];
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function storeContractSummaryCache(settings, body) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    if (!baseUrl) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(`${baseUrl}/contract-summaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.log('Contract summary cache store failed:', response.status, payload?.error || response.statusText);
      }
    } catch (e) {
      console.log('Contract summary cache store error:', e?.message || e);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function renderSummaryShell(state = 'idle', message = '') {
    const label = state === 'cached'
      ? 'Cached'
      : (state === 'generated' ? 'Generated' : (state === 'loading' ? 'Loading' : 'OpenRouter'));
    const statusClass = state === 'error' ? 'error' : (state === 'loading' ? 'loading' : '');
    return `<div class="evmole-summary" data-state="${escapeHtml(state)}">
      <div class="summary-header">
        <div>
          <div class="summary-title">Contract Summary</div>
          <div class="summary-status ${statusClass}">${escapeHtml(message || label)}</div>
          <div class="summary-identifiers" style="display:none;"></div>
        </div>
        <div class="summary-actions">
          <button type="button" class="summary-action summarize">Summarize</button>
          <button type="button" class="summary-action retry" style="display:none;">Try again</button>
          <button type="button" class="summary-action reload" title="Reload context" aria-label="Reload context" style="display:none;">↻</button>
        </div>
      </div>
      <div class="summary-content"></div>
    </div>`;
  }

  function renderSummaryList(items, limit = 3) {
    const values = Array.isArray(items) ? items.filter(Boolean).slice(0, limit) : [];
    if (values.length === 0) return '';
    return `<ul>${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function getAddressFromSummaryFactValue(value) {
    return extractAddressFromText(value);
  }

  function truncateAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function renderSummaryFactValue(value) {
    const rawValue = String(value || '');
    const address = getAddressFromSummaryFactValue(rawValue);
    if (!address) return escapeHtml(rawValue);
    return `<button type="button" class="summary-fact-address" data-copy-address="${escapeHtml(address)}" title="${escapeHtml(address)}" aria-label="Copy ${escapeHtml(address)}">${escapeHtml(truncateAddress(address))}</button>`;
  }

  function renderSummaryFacts(facts) {
    const values = compactSummaryFacts(facts).slice(0, 6);
    if (values.length === 0) return '';
    return `<div class="summary-facts">${values.map(fact => `
      <div class="summary-fact">
        <div class="summary-fact-label">${escapeHtml(fact.label || 'Fact')}</div>
        <div class="summary-fact-value">${renderSummaryFactValue(fact.value || '')}</div>
        ${fact.source ? `<div class="summary-fact-source">${escapeHtml(fact.source)}</div>` : ''}
      </div>
    `).join('')}</div>`;
  }

  function compactSummaryFacts(facts) {
    const values = Array.isArray(facts)
      ? facts.filter(fact => fact?.label || fact?.value).map(fact => ({ ...fact }))
      : [];
    const normalizedLabel = fact => String(fact?.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedSource = fact => String(fact?.source || '').toLowerCase();
    const normalizedValue = fact => String(fact?.value || '').toLowerCase().replace(/[,\s]/g, '');
    const isNameFact = fact => ['name', 'tokenname'].includes(normalizedLabel(fact)) || normalizedSource(fact).includes('name()');
    const isSymbolFact = fact => ['symbol', 'tokensymbol'].includes(normalizedLabel(fact)) || normalizedSource(fact).includes('symbol()');
    const isTotalSupplyFact = fact => normalizedLabel(fact).includes('totalsupply') || normalizedSource(fact).includes('totalsupply()');
    const isMaxSupplyFact = fact => normalizedLabel(fact).includes('maxsupply') || normalizedSource(fact).includes('maxsupply()');
    const isRawHookFlagFact = fact => {
      const label = normalizedLabel(fact);
      const source = normalizedSource(fact).replace(/\s/g, '');
      return label === 'hookflags'
        || label === 'hookpermissions'
        || source.includes('contractidentifiers.hookflags')
        || source.includes('gethookpermissions()');
    };
    const sourcePair = (a, b) => [...new Set([a?.source, b?.source].filter(Boolean))].join(' + ');

    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (isRawHookFlagFact(values[index])) values.splice(index, 1);
    }

    const combinePair = (firstIndex, secondIndex, combined) => {
      if (firstIndex < 0 || secondIndex < 0) return;
      const insertAt = Math.min(firstIndex, secondIndex);
      const removeAt = Math.max(firstIndex, secondIndex);
      values.splice(removeAt, 1);
      values.splice(insertAt, 1, combined);
    };

    const nameIndex = values.findIndex(isNameFact);
    const symbolIndex = values.findIndex(isSymbolFact);
    if (nameIndex !== -1 && symbolIndex !== -1 && nameIndex !== symbolIndex) {
      const nameFact = values[nameIndex];
      const symbolFact = values[symbolIndex];
      const nameValue = String(nameFact.value || '').trim();
      const symbolValue = String(symbolFact.value || '').trim();
      combinePair(nameIndex, symbolIndex, {
        label: 'Name',
        value: nameValue && symbolValue && !nameValue.includes(`(${symbolValue})`) ? `${nameValue} (${symbolValue})` : nameValue || symbolValue,
        source: sourcePair(nameFact, symbolFact)
      });
    }

    const totalSupplyIndex = values.findIndex(isTotalSupplyFact);
    const maxSupplyIndex = values.findIndex(isMaxSupplyFact);
    if (totalSupplyIndex !== -1 && maxSupplyIndex !== -1 && totalSupplyIndex !== maxSupplyIndex) {
      const totalSupplyFact = values[totalSupplyIndex];
      const maxSupplyFact = values[maxSupplyIndex];
      if (normalizedValue(totalSupplyFact) && normalizedValue(totalSupplyFact) === normalizedValue(maxSupplyFact)) {
        combinePair(totalSupplyIndex, maxSupplyIndex, {
          label: 'Supply',
          value: totalSupplyFact.value || maxSupplyFact.value,
          source: sourcePair(totalSupplyFact, maxSupplyFact)
        });
      }
    }

    return values;
  }

  function formatElapsedTime(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatOptionalElapsedTime(ms) {
    return Number.isFinite(ms) ? formatElapsedTime(ms) : 'n/a';
  }

  function formatSummaryProviderTiming(provider, response, fallbackMs) {
    const timing = response?.timing || {};
    if (provider !== 'codex') return `${provider} ${formatElapsedTime(fallbackMs)}`;

    const effort = timing.reasoningEffort || 'unknown effort';
    const firstOutput = timing.firstOutputDeltaMs ?? timing.completedEventMs ?? null;
    const headers = timing.responseHeadersMs ?? null;
    const firstEvent = timing.firstEventMs ?? timing.firstChunkMs ?? null;
    return [
      `codex ${formatElapsedTime(fallbackMs)}`,
      effort,
      `headers ${formatOptionalElapsedTime(headers)}`,
      `first event ${formatOptionalElapsedTime(firstEvent)}`,
      `first output ${formatOptionalElapsedTime(firstOutput)}`
    ].join(', ');
  }

  function renderSummaryResult(summary) {
    const creatorAddress = extractAddressFromText(summary?.contract_creator?.address || '');
    const baseFacts = Array.isArray(summary?.facts) ? summary.facts : [];
    const hasCreatorFact = creatorAddress && baseFacts.some(fact => {
      const label = String(fact?.label || '').toLowerCase();
      const value = String(fact?.value || '');
      return label.includes('creator') || value.includes(creatorAddress);
    });
    const facts = creatorAddress && !hasCreatorFact
      ? [
        {
          label: summary?.contract_creator?.label || 'Contract creator',
          value: creatorAddress,
          source: summary?.contract_creator?.source || 'explorer'
        },
        ...baseFacts
      ]
      : baseFacts;
    const readContext = Array.isArray(summary?.read_context) ? summary.read_context.slice(0, 3) : [];
    const unknowns = Array.isArray(summary?.unknowns) ? summary.unknowns.slice(0, 3) : [];
    const keyBehaviors = Array.isArray(summary?.key_behaviors) ? summary.key_behaviors.slice(0, 3) : [];
    const implementationUniqueness = Array.isArray(summary?.implementation_uniqueness) ? summary.implementation_uniqueness.slice(0, 4) : [];
    const limits = Array.isArray(summary?.limits_taxes_and_rules) ? summary.limits_taxes_and_rules.slice(0, 4) : [];
    const controls = Array.isArray(summary?.privileged_controls) ? summary.privileged_controls.slice(0, 2) : [];
    return `<div class="summary-result">
      <div class="summary-meta">
        <span>${escapeHtml(summary?.contract_type || 'unknown')}</span>
        <span>${escapeHtml(summary?.confidence || 'low')} confidence</span>
      </div>
      ${renderSummaryFacts(facts)}
      <p>${escapeHtml(summary?.summary || 'No summary returned.')}</p>
      ${renderSummaryList(keyBehaviors)}
      ${implementationUniqueness.length ? `<div class="summary-subhead">Implementation uniqueness</div>${renderSummaryList(implementationUniqueness, 4)}` : ''}
      ${limits.length ? `<div class="summary-subhead">Limits/rules</div>${renderSummaryList(limits, 4)}` : ''}
      ${controls.length ? `<div class="summary-subhead">Controls</div>${renderSummaryList(controls)}` : ''}
      ${readContext.length ? `<div class="summary-subhead">Read context</div><ul>${readContext.map(entry => `<li><strong>${escapeHtml(entry.name || 'read')}</strong>: ${escapeHtml(entry.value || '')}${entry.meaning ? ` — ${escapeHtml(entry.meaning)}` : ''}</li>`).join('')}</ul>` : ''}
      ${unknowns.length ? `<div class="summary-subhead">Unknowns</div><ul>${unknowns.map(entry => `<li><strong>${escapeHtml(entry.selector || 'unknown')}</strong>: ${escapeHtml(entry.reason || '')}${entry.suggested_next_read ? ` Next: ${escapeHtml(entry.suggested_next_read)}` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function setSummaryState(summaryPanel, state, { message = '', summary = null, contextInvalidated = false } = {}) {
    const summaryEl = summaryPanel.querySelector('.evmole-summary');
    if (!summaryEl) return;

    summaryEl.dataset.state = state;
    summaryEl.dataset.contextInvalidated = contextInvalidated ? 'true' : 'false';
    const statusEl = summaryEl.querySelector('.summary-status');
    const contentEl = summaryEl.querySelector('.summary-content');
    const summarizeBtn = summaryEl.querySelector('.summary-action.summarize');
    const retryBtn = summaryEl.querySelector('.summary-action.retry');
    const reloadBtn = summaryEl.querySelector('.summary-action.reload');

    statusEl.className = `summary-status ${state === 'error' ? 'error' : (state === 'loading' ? 'loading' : '')}`;
    statusEl.textContent = message || (state === 'cached' ? 'Cached' : (state === 'generated' ? 'Generated' : 'OpenRouter'));
    contentEl.innerHTML = summary ? renderSummaryResult(summary) : '';

    summarizeBtn.style.display = summary || state === 'loading' ? 'none' : '';
    retryBtn.style.display = state === 'error' ? '' : 'none';
    if (contextInvalidated) retryBtn.textContent = 'Reload page';
    else retryBtn.textContent = 'Try again';
    reloadBtn.style.display = summary ? '' : 'none';
    summarizeBtn.disabled = state === 'loading';
    retryBtn.disabled = state === 'loading';
    reloadBtn.disabled = state === 'loading';
  }

  function bindSummaryFactCopy(summaryPanel) {
    if (summaryPanel.dataset.factCopyBound === 'true') return;
    summaryPanel.dataset.factCopyBound = 'true';
    summaryPanel.addEventListener('click', event => {
      const button = event.target.closest('.summary-fact-address');
      if (!button || !summaryPanel.contains(button)) return;

      event.preventDefault();
      event.stopPropagation();
      const address = button.dataset.copyAddress || '';
      if (!address) return;

      navigator.clipboard?.writeText(address).then(() => {
        const previous = button.textContent;
        button.textContent = 'Copied';
        button.classList.add('copied');
        window.setTimeout(() => {
          button.textContent = previous;
          button.classList.remove('copied');
        }, 900);
      }).catch(() => {});
    });
  }

  function renderChatText(value) {
      return escapeHtml(value).replace(/\n/g, '<br>');
    }

    function svgToDataImage(svgText) {
      const svg = String(svgText || '').trim();
      if (!/^<svg[\s>]/i.test(svg)) return '';
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

  async function displayFunctionSelectors() {
    // Check if relevant elements exist before creating the panel
    const editorElement = document.querySelector('#editor');

    if (!hasBytecodeCandidateOnPage() && !hasContractCodeCandidateOnPage() && !editorElement) {
      console.log('No relevant elements found. Panel will not be displayed.');
      return;
    }

    const settings = await getExtensionSettings();
    const summaryPanel = createSummaryPanel(renderSummaryShell('idle'));
    bindSummaryFactCopy(summaryPanel);
    const chatPanel = createContractChatPanel();
    const panel = createRightPanel('<div id="selectors">Loading...</div>', {
      defaultCollapsed: settings.contractFunctionsDefaultCollapsed
    });
    
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
      'getHookPermissions()',
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
      '0xc4e833ce', // getHookPermissions
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
    const summaryReadRequests = new Map();
    const chatToolReadRequests = new Map();
    const contractMentionAnalysisRequests = new Map();
    let latestSummaryContextBase = null;
    let latestCallableFunctionRegistry = [];
    let latestSummaryResult = null;
    let autoSummaryHydrationKey = null;
    let summaryCacheMissKey = null;
    let autoSummaryAttempted = false;
    let relatedContractsForCreator = [];

    const UNISWAP_V4_HOOK_SELECTORS = {
      '0xdc98354e': 'beforeInitialize(address,(address,address,uint24,int24,address),uint160)',
      '0x6fe7e6eb': 'afterInitialize(address,(address,address,uint24,int24,address),uint160,int24)',
      '0x259982e5': 'beforeAddLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)',
      '0x9f063efc': 'afterAddLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),int256,int256,bytes)',
      '0x21d0ee70': 'beforeRemoveLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)',
      '0x6c2bbe7e': 'afterRemoveLiquidity(address,(address,address,uint24,int24,address),(int24,int24,int256,bytes32),int256,int256,bytes)',
      '0x575e24b4': 'beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)',
      '0xb47b2fb1': 'afterSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),int256,bytes)',
      '0xb6a8b0fa': 'beforeDonate(address,(address,address,uint24,int24,address),uint256,uint256,bytes)',
      '0xe1b4af69': 'afterDonate(address,(address,address,uint24,int24,address),uint256,uint256,bytes)'
    };
    const UNISWAP_V4_BASE_HOOK_SELECTORS = {
      '0xc4e833ce': 'getHookPermissions()',
      '0xdc4c90d3': 'poolManager()'
    };
    const ERC20_TOKEN_SELECTORS = {
      '0x06fdde03': 'name()',
      '0x95d89b41': 'symbol()',
      '0x313ce567': 'decimals()',
      '0x18160ddd': 'totalSupply()',
      '0x70a08231': 'balanceOf(address)',
      '0xa9059cbb': 'transfer(address,uint256)',
      '0x23b872dd': 'transferFrom(address,address,uint256)',
      '0x095ea7b3': 'approve(address,uint256)',
      '0xdd62ed3e': 'allowance(address,address)'
    };
    const ERC721_NFT_SELECTORS = {
      '0x01ffc9a7': 'supportsInterface(bytes4)',
      '0x70a08231': 'balanceOf(address)',
      '0x6352211e': 'ownerOf(uint256)',
      '0x42842e0e': 'safeTransferFrom(address,address,uint256)',
      '0xb88d4fde': 'safeTransferFrom(address,address,uint256,bytes)',
      '0x23b872dd': 'transferFrom(address,address,uint256)',
      '0x095ea7b3': 'approve(address,uint256)',
      '0x081812fc': 'getApproved(uint256)',
      '0xa22cb465': 'setApprovalForAll(address,bool)',
      '0xe985e9c5': 'isApprovedForAll(address,address)',
      '0xc87b56dd': 'tokenURI(uint256)',
      '0x06fdde03': 'name()',
      '0x95d89b41': 'symbol()'
    };
    const UNISWAP_V4_SWAP_HOOK_SELECTORS = new Set(['0x575e24b4', '0xb47b2fb1']);
    const UNISWAP_V4_INTERESTING_SELECTORS = {
      '0xaf67e1e8': 'previewSwapTax(bool,address,uint256)',
      '0xd67c7c49': 'previewBuyInputTax(uint256)',
      '0xee255397': 'currentBuyEthTaxBps()',
      '0xecfc021f': 'setTaxes(uint16,uint16,uint16,uint16)',
      '0xa597d941': 'setTraderWallet(address)',
      '0xd08e7b69': 'setInsuranceWallet(address)',
      '0x0bba34d5': 'notifyMigration()',
      '0x8e760afe': 'verify(bytes)',
      '0x238ac933': 'signer()',
      '0x7ecebe00': 'nonces(address)',
      '0x5124ae95': 'getNonces(address)',
      '0x58197a9d': 'sellEnabled()',
      '0x5975db02': 'lastUser(uint256)',
      '0x942b765a': 'getList()',
      '0xe7c340de': 'sniperProtectionActive()',
      '0x001fd5fe': 'sniperProtectionEndBlock()',
      '0x42162044': 'migrationBlock()'
    };
    const UNISWAP_V4_HOOK_FLAGS = [
      { bit: 1n << 13n, name: 'beforeInitialize' },
      { bit: 1n << 12n, name: 'afterInitialize' },
      { bit: 1n << 11n, name: 'beforeAddLiquidity' },
      { bit: 1n << 10n, name: 'afterAddLiquidity' },
      { bit: 1n << 9n, name: 'beforeRemoveLiquidity' },
      { bit: 1n << 8n, name: 'afterRemoveLiquidity' },
      { bit: 1n << 7n, name: 'beforeSwap' },
      { bit: 1n << 6n, name: 'afterSwap' },
      { bit: 1n << 5n, name: 'beforeDonate' },
      { bit: 1n << 4n, name: 'afterDonate' },
      { bit: 1n << 3n, name: 'beforeSwapReturnDelta', requires: 'beforeSwap' },
      { bit: 1n << 2n, name: 'afterSwapReturnDelta', requires: 'afterSwap' },
      { bit: 1n << 1n, name: 'afterAddLiquidityReturnDelta', requires: 'afterAddLiquidity' },
      { bit: 1n << 0n, name: 'afterRemoveLiquidityReturnDelta', requires: 'afterRemoveLiquidity' }
    ];
    let activeMentionRange = null;
    let activeMentionSelection = 0;
    const chatHistory = [];
    await postVerifiedAbiToSignatureDb(settings, contractAddress);
    injectScript('evmole-script.js', document.head || document.documentElement, {
      signatureDatabaseUrl: settings.signatureDatabaseUrl || '',
      signatureDatabaseStoreUnknowns: settings.signatureDatabaseStoreUnknowns ? 'true' : 'false'
    });

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

    function functionNameFromSignature(signature) {
      return String(signature || '').split('(')[0].trim();
    }

    function normalizeQuestion(value) {
      return String(value || '').toLowerCase().replace(/[_-]+/g, ' ');
    }

    function inferCallableTags(record) {
      const name = normalizeFunctionNameForMatch(record?.name || record?.signature || '');
      const tags = [];
      const add = (tag, ...patterns) => {
        if (patterns.some(pattern => functionNameHas(name, pattern))) tags.push(tag);
      };

      add('owner', 'owner', 'ownership');
      add('admin', 'admin', 'operator', 'manager', 'governor', 'role', 'controller');
      add('fee', 'fee', 'tax', 'bps', 'split', 'royalty');
      add('limit', 'limit', 'cap', 'max', 'min', 'threshold', 'cooldown');
      add('token', 'name', 'symbol', 'decimals', 'supply', 'balanceof', 'allowance', 'transfer', 'approve');
      add('router', 'router', 'factory', 'pair', 'pool', 'weth', 'poolmanager', 'poolkey');
      add('nft', 'tokenuri', 'uri', 'ownerof', 'getapproved', 'approvalforall');
      add('launch', 'trading', 'launch', 'sale', 'enabled', 'finalize', 'paused', 'pause');
      add('metadata', 'uri', 'url', 'metadata', 'image');
      return [...new Set(tags)];
    }

    function buildCallableFunctionRegistry(selectorRecords, verifiedFunctions) {
      const verifiedMaps = buildVerifiedFunctionMaps(verifiedFunctions || []);
      return (selectorRecords || []).map(record => {
        const actualSignature = String(record?.signature || '').trim();
        const heuristicName = normalizeHeuristicName(record?.heuristicName || '');
        const rawInputTypes = splitTopLevelAbiTypes(record.args || '');
        const signature = actualSignature && actualSignature !== 'Unknown'
          ? actualSignature
          : (heuristicName ? `${heuristicName}(${rawInputTypes.join(',')})` : actualSignature);
        const name = functionNameFromSignature(signature);
        if (!signature || signature === 'Unknown' || !name) return null;

        const verified = actualSignature && actualSignature !== 'Unknown'
          ? (verifiedMaps.bySignature.get(actualSignature)
            || verifiedMaps.byNameAndInputs.get(`${name.toLowerCase()}(${rawInputTypes.join(',')})`))
          : null;
        const inputTypes = (verified?.inputTypes?.length ? verified.inputTypes : rawInputTypes)
          .map(normalizeAbiType);
        if (inputTypes.some(type => !type)) return null;

        const mutability = String(verified?.stateMutability || record.mutability || '').toLowerCase();
        const isRead = mutability === 'view' || mutability === 'pure';
        const inputNames = verified?.inputNames?.length === inputTypes.length
          ? verified.inputNames
          : inputTypes.map((_, index) => `arg${index}`);
        const callable = {
          selector: normalizeSelectorId(record.selector),
          signature,
          name,
          mutability,
          inputTypes,
          inputNames,
          inputCount: inputTypes.length,
          callMode: isRead ? 'read' : 'simulate',
          isRead,
          tags: []
        };
        callable.tags = inferCallableTags(callable);
        return callable;
      }).filter(record => record?.selector && record.selector.length === 10);
    }

    function extractQuestionAddresses(question) {
      return [...String(question || '').matchAll(/0x[a-fA-F0-9]{40}/g)]
        .map(match => match[0])
        .filter((address, index, list) => list.findIndex(entry => normalizeAddressKey(entry) === normalizeAddressKey(address)) === index);
    }

    function extractQuestionIntegers(question) {
      const text = String(question || '');
      return [...text.matchAll(/\b\d{1,78}\b/g)]
        .filter(match => text[match.index - 1] !== '.' && text[match.index + match[0].length] !== '.')
        .map(match => match[0]);
    }

    function extractQuestionBools(question) {
      const values = [];
      if (/\btrue\b/i.test(question)) values.push('true');
      if (/\bfalse\b/i.test(question)) values.push('false');
      return values;
    }

    function extractEthValueWei(question) {
      const match = String(question || '').match(/\b(\d+(?:\.\d+)?)\s*(?:eth|ether)\b/i);
      if (!match) return null;
      try {
        return decimalToScaledInteger(match[1], 18);
      } catch {
        return null;
      }
    }

    function extractSimulationFromAddress(question) {
      const match = String(question || '').match(/\b(?:as|sender)\s*(0x[a-fA-F0-9]{40})\b/i);
      return match ? match[1] : '';
    }

    function isSimulationQuestion(question) {
      return /\b(?:simulate|simulation|eth_call|call|revert|fail|fails|would|try|test)\b/i.test(question);
    }

    function questionMentionsFunction(question, callable) {
      const normalized = normalizeQuestion(question);
      const name = String(callable?.name || '').toLowerCase();
      const readableName = name.replace(/_/g, ' ');
      const signature = String(callable?.signature || '').toLowerCase();
      const actionWords = ['buy', 'sell', 'swap', 'transfer', 'approve', 'mint', 'burn', 'deposit', 'withdraw', 'stake', 'unstake', 'claim', 'contribute', 'refund'];
      return Boolean(name && (
        normalized.includes(name.toLowerCase())
        || normalized.includes(readableName)
        || normalized.replace(/\s+/g, '').includes(signature.replace(/\s+/g, ''))
        || actionWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(question) && functionNameHas(name, word))
      ));
    }

    function functionMatchesIntent(question, callable) {
      const normalized = normalizeQuestion(question);
      const tags = new Set(callable.tags || []);
      const name = String(callable.name || '').toLowerCase();

      if (questionMentionsFunction(question, callable)) return true;
      if (/\b(?:who owns|owner|ownership)\b/.test(normalized)) {
        if (name === 'ownerof' && !/\b(?:token|token\s*id|#|nft)\b/.test(normalized)) return false;
        return tags.has('owner') || name === 'owner';
      }
      if (/\b(?:admin|operator|manager|role|permission|privileged)\b/.test(normalized)) return tags.has('admin') || tags.has('owner');
      if (/\b(?:fee|fees|tax|taxes|bps|royalty)\b/.test(normalized)) return tags.has('fee');
      if (/\b(?:limit|cap|max|min|threshold|cooldown|rule|rules)\b/.test(normalized)) return tags.has('limit');
      if (/\b(?:router|factory|pair|pool|weth|pool manager)\b/.test(normalized)) return tags.has('router');
      if (/\b(?:trading|launch|paused|enabled|finalize|sale)\b/.test(normalized)) return tags.has('launch');
      if (/\b(?:name|symbol|decimals|supply|token)\b/.test(normalized)) return tags.has('token') && callable.inputCount === 0;
      if (/\b(?:balance|balanceof)\b/.test(normalized)) return name === 'balanceof';
      if (/\b(?:allowance)\b/.test(normalized)) return name === 'allowance';
      if (/\b(?:token\s*uri|tokenuri|metadata|image|svg|animation|nft)\b/.test(normalized)) return tags.has('nft') || tags.has('metadata');
      if (/\btoken\b/.test(normalized) && extractTokenId(question) && (tags.has('nft') || tags.has('metadata'))) return true;
      return false;
    }

    function rankCallableForQuestion(question, callable) {
      let score = 0;
      if (questionMentionsFunction(question, callable)) score += 1000;
      if (callable.isRead) score += 100;
      if (callable.inputCount === 0) score += 50;
      if (functionMatchesIntent(question, callable)) score += 200;
      if (['owner', 'name', 'symbol', 'decimals', 'totalsupply', 'balanceof', 'allowance', 'tokenuri'].includes(callable.name.toLowerCase())) score += 40;
      return score;
    }

    function buildKnownArgumentAddresses() {
      const creator = getContractCreatorInfo();
      return {
        contract: contractAddress,
        creator: creator?.address || ''
      };
    }

    function resolveCallableArguments(question, callable) {
      const inputTypes = callable.inputTypes || [];
      const addressValues = extractQuestionAddresses(question);
      const integerValues = extractQuestionIntegers(question);
      const boolValues = extractQuestionBools(question);
      const ethValueWei = extractEthValueWei(question);
      const simulationFrom = callable.callMode === 'simulate' ? extractSimulationFromAddress(question) : '';
      const knownAddresses = buildKnownArgumentAddresses();
      const args = [];
      const missing = [];
      let addressIndex = 0;
      let integerIndex = 0;
      let boolIndex = 0;

      for (let index = 0; index < inputTypes.length; index += 1) {
        const type = inputTypes[index];
        const inputName = String(callable.inputNames?.[index] || `arg${index}`);
        const lowerName = inputName.toLowerCase();

        if (type === 'address') {
          const value = addressValues[addressIndex++]
            || (/contract|token|this/.test(lowerName) ? knownAddresses.contract : '')
            || (/creator|deployer/.test(lowerName) ? knownAddresses.creator : '');
          if (value && /^0x[a-fA-F0-9]{40}$/.test(value)) {
            args.push(value);
          } else {
            missing.push(`${inputName || `arg${index}`} (${type})`);
          }
          continue;
        }

        if (isUintAbiInput(type) || type.startsWith('int')) {
          const value = (/amount|value|eth|wei/.test(lowerName) && ethValueWei) ? ethValueWei : integerValues[integerIndex++];
          if (value && /^(?:0x[a-fA-F0-9]+|\d+)$/.test(value)) {
            args.push(value);
          } else {
            missing.push(`${inputName || `arg${index}`} (${type})`);
          }
          continue;
        }

        if (type === 'bool') {
          const value = boolValues[boolIndex++];
          if (value) {
            args.push(value);
          } else {
            missing.push(`${inputName || `arg${index}`} (${type})`);
          }
          continue;
        }

        if (type === 'bytes' || /^bytes\d+$/.test(type)) {
          const hex = String(question || '').match(/0x[a-fA-F0-9]+/)?.[0] || '';
          if (hex && hex.length % 2 === 0) {
            args.push(hex);
          } else {
            missing.push(`${inputName || `arg${index}`} (${type})`);
          }
          continue;
        }

        if (type === 'string') {
          missing.push(`${inputName || `arg${index}`} (${type})`);
          continue;
        }

        missing.push(`${inputName || `arg${index}`} (${type})`);
      }

      return {
        args,
        missing,
        callOptions: callable.callMode === 'simulate'
          ? {
            ...(ethValueWei ? { value: ethValueWei } : {}),
            ...(simulationFrom ? { from: simulationFrom } : {})
          }
          : {}
      };
    }

    function planChatFunctionCalls(question) {
      const registry = latestCallableFunctionRegistry || [];
      const simulationRequested = isSimulationQuestion(question);
      const matching = registry
        .filter(callable => functionMatchesIntent(question, callable))
        .filter(callable => callable.isRead || (simulationRequested && questionMentionsFunction(question, callable)))
        .map(callable => ({ callable, score: rankCallableForQuestion(question, callable) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.callable);

      const limit = simulationRequested ? 3 : 6;
      return matching.slice(0, limit).map(callable => ({
        callable,
        ...resolveCallableArguments(question, callable)
      }));
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
          return selector
            && signature
            && !linkScanRequestedSelectors.has(selector);
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

    function renderPanelBody(selectorsHtml) {
      panel.innerHTML = selectorsHtml;
      if (latestSummaryResult) {
        setSummaryState(summaryPanel, latestSummaryResult.source || 'generated', {
          summary: latestSummaryResult.summary
        });
      }
    }

    function attachSummaryControls() {
      const summaryEl = summaryPanel.querySelector('.evmole-summary');
      if (!summaryEl || summaryEl.dataset.bound === 'true') return;
      summaryEl.dataset.bound = 'true';

      const summarize = () => generateContractSummary({ bypassCache: false, reloadContext: false });
      summaryEl.querySelector('.summary-action.summarize')?.addEventListener('click', event => {
        event.stopPropagation();
        summarize();
      });
      summaryEl.querySelector('.summary-action.retry')?.addEventListener('click', event => {
        event.stopPropagation();
        if (summaryEl.dataset.contextInvalidated === 'true') {
          window.location.reload();
          return;
        }
        generateContractSummary({ bypassCache: true, reloadContext: false });
      });
      summaryEl.querySelector('.summary-action.reload')?.addEventListener('click', event => {
        event.stopPropagation();
        generateContractSummary({ bypassCache: true, reloadContext: true });
      });
    }

    function getFunctionName(record) {
      return String(record?.signature || '').split('(')[0].toLowerCase();
    }

    function normalizeFunctionNameForMatch(value) {
      return String(value || '').split('(')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function functionNameHas(name, pattern) {
      const rawName = String(name || '').toLowerCase();
      const rawPattern = String(pattern || '').toLowerCase();
      const normalizedName = normalizeFunctionNameForMatch(rawName);
      const normalizedPattern = normalizeFunctionNameForMatch(rawPattern);
      return rawName.includes(rawPattern) || (!!normalizedPattern && normalizedName.includes(normalizedPattern));
    }

    function normalizeSelectorId(selector) {
      const text = String(selector || '').trim().toLowerCase();
      if (!text) return '';
      return text.startsWith('0x') ? text : `0x${text}`;
    }

    function decodeUniswapV4HookFlags(address) {
      try {
        const numeric = BigInt(String(address || '').trim());
        const lowBits = numeric & ((1n << 14n) - 1n);
        const flags = UNISWAP_V4_HOOK_FLAGS
          .filter(flag => (lowBits & flag.bit) !== 0n)
          .map(flag => flag.name);
        const flagSet = new Set(flags);
        const returnDeltaFlagsAreValid = UNISWAP_V4_HOOK_FLAGS
          .filter(flag => flag.requires && flagSet.has(flag.name))
          .every(flag => flag.requires && flagSet.has(flag.requires));

        return {
          mask: `0x${lowBits.toString(16).padStart(4, '0')}`,
          flags,
          isValidV4HookAddress: lowBits > 0n && returnDeltaFlagsAreValid
        };
      } catch {
        return {
          mask: '0x0000',
          flags: [],
          isValidV4HookAddress: false
        };
      }
    }

    function matchKnownSelectorMap(functions, known) {
      const knownSelectors = new Set(Object.keys(known));
      return [...new Set((functions || [])
        .map(record => normalizeSelectorId(record?.selector))
        .filter(selector => knownSelectors.has(selector)))]
        .sort()
        .map(selector => ({ selector, signature: known[selector] }));
    }

    function classifyUniswapV4HookScore(score, hasSwapHookEvidence) {
      if (score >= 6 && !hasSwapHookEvidence) return 'possible_non_swap_hook';
      if (score >= 30) return 'confirmed_hook_pattern';
      if (score >= 15) return 'likely_hook';
      if (score >= 6) return 'possible_hook';
      return 'not_enough_evidence';
    }

    function identifyUniswapV4Hook(functions) {
      const matchedBaseHookSelectors = matchKnownSelectorMap(functions, UNISWAP_V4_BASE_HOOK_SELECTORS);
      const matchedHookSelectors = matchKnownSelectorMap(functions, UNISWAP_V4_HOOK_SELECTORS);
      const matchedSwapHookSelectors = matchedHookSelectors.filter(entry => UNISWAP_V4_SWAP_HOOK_SELECTORS.has(entry.selector));
      const matchedRiskSelectors = matchKnownSelectorMap(functions, UNISWAP_V4_INTERESTING_SELECTORS);
      const hookFlags = decodeUniswapV4HookFlags(contractAddress);
      const hasSwapHookEvidence = matchedSwapHookSelectors.length > 0;
      const hasHookSelectorEvidence = matchedHookSelectors.length > 0 || matchedBaseHookSelectors.length >= 2;
      const score = Math.min(matchedBaseHookSelectors.length, 2) * 5
        + matchedHookSelectors.length * 3
        + (hasHookSelectorEvidence && hookFlags.isValidV4HookAddress ? 10 : 0);
      const candidateReasons = [];

      if (hasHookSelectorEvidence && hookFlags.isValidV4HookAddress) candidateReasons.push('address_bits');
      if (matchedBaseHookSelectors.length > 0) candidateReasons.push('base_hook_signature');
      if (matchedHookSelectors.length > 0) candidateReasons.push('hook_callback_signature');
      if (hasSwapHookEvidence) candidateReasons.push('swap_hook_evidence');
      if (matchedRiskSelectors.length > 0) candidateReasons.push('interesting_control_signature');

      return {
        id: 'uniswap_v4_hook',
        label: hasSwapHookEvidence ? 'Uniswap v4 swap hook' : 'Uniswap v4 hook',
        classification: classifyUniswapV4HookScore(score, hasSwapHookEvidence),
        score,
        isCandidate: hasHookSelectorEvidence,
        hookFlags,
        hasSwapHookEvidence,
        candidateReasons,
        matchedBaseHookSelectors,
        matchedHookSelectors,
        matchedSwapHookSelectors,
        matchedRiskSelectors
      };
    }

    function identifyErc20Token(functions) {
      const matchedTokenSelectors = matchKnownSelectorMap(functions, ERC20_TOKEN_SELECTORS);
      const matchedSelectorIds = new Set(matchedTokenSelectors.map(entry => entry.selector));
      const hasCoreTransferSurface = matchedSelectorIds.has('0x18160ddd')
        && matchedSelectorIds.has('0x70a08231')
        && matchedSelectorIds.has('0xa9059cbb');
      const hasMetadataSurface = matchedSelectorIds.has('0x06fdde03')
        && matchedSelectorIds.has('0x95d89b41')
        && matchedSelectorIds.has('0x313ce567');
      const isCandidate = matchedTokenSelectors.length >= 4 || hasCoreTransferSurface || (hasMetadataSurface && matchedTokenSelectors.length >= 3);

      return {
        id: 'erc20_token',
        label: 'ERC-20 token',
        classification: hasCoreTransferSurface ? 'standard_erc20_surface' : 'partial_erc20_surface',
        score: matchedTokenSelectors.length,
        isCandidate,
        matchedTokenSelectors
      };
    }

    function identifyErc721Nft(functions) {
      const matchedNftSelectors = matchKnownSelectorMap(functions, ERC721_NFT_SELECTORS);
      const matchedSelectorIds = new Set(matchedNftSelectors.map(entry => entry.selector));
      const hasApprovalForAll = matchedSelectorIds.has('0xa22cb465');
      const hasOwnerTokenSurface = matchedSelectorIds.has('0x6352211e')
        || matchedSelectorIds.has('0xc87b56dd')
        || matchedSelectorIds.has('0x081812fc');
      const hasTransferSurface = matchedSelectorIds.has('0x42842e0e')
        || matchedSelectorIds.has('0xb88d4fde')
        || matchedSelectorIds.has('0x23b872dd');
      const hasNftSpecificSurface = matchedSelectorIds.has('0x01ffc9a7')
        || matchedSelectorIds.has('0x6352211e')
        || matchedSelectorIds.has('0xc87b56dd')
        || matchedSelectorIds.has('0x081812fc')
        || matchedSelectorIds.has('0xe985e9c5')
        || matchedSelectorIds.has('0x42842e0e')
        || matchedSelectorIds.has('0xb88d4fde');
      const isCandidate = hasApprovalForAll || (hasNftSpecificSurface && hasOwnerTokenSurface && hasTransferSurface);

      return {
        id: 'erc721_nft',
        label: 'ERC-721 NFT',
        classification: hasApprovalForAll && hasOwnerTokenSurface ? 'standard_erc721_surface' : 'probable_erc721_surface',
        score: matchedNftSelectors.length + (hasApprovalForAll ? 3 : 0),
        isCandidate,
        matchedNftSelectors
      };
    }

    function detectContractIdentifiers(functions) {
      const identifiers = [];
      const erc721Nft = identifyErc721Nft(functions);
      if (erc721Nft.isCandidate) identifiers.push(erc721Nft);
      const erc20Token = identifyErc20Token(functions);
      if (erc20Token.isCandidate) identifiers.push(erc20Token);
      const uniswapV4Hook = identifyUniswapV4Hook(functions);
      if (uniswapV4Hook.isCandidate) identifiers.push(uniswapV4Hook);
      return identifiers;
    }

    function getSidebarContractBadges(functions) {
      const selectorIds = new Set((functions || []).map(record => normalizeSelectorId(record?.selector)).filter(Boolean));
      const badges = [];

      if (selectorIds.has('0xa22cb465')) {
        badges.push({
          id: 'nft-erc721',
          label: 'NFT ERC721',
          selector: '0xa22cb465',
          signature: 'setApprovalForAll(address,bool)'
        });
      }

      return badges;
    }

    function renderContractBadgeList(functions, className) {
      const badges = getSidebarContractBadges(functions);
      if (badges.length === 0) return '';

      return `<div class="${escapeHtml(className)}">${badges.map(badge => `
        <span class="contract-identifier-badge ${escapeHtml(badge.id)}" title="${escapeHtml(`${badge.selector} ${badge.signature}`)}">
          ${escapeHtml(badge.label)}
        </span>
      `).join('')}</div>`;
    }

    function updateSummaryContractBadges(functions) {
      const target = summaryPanel.querySelector('.summary-identifiers');
      if (!target) return;

      const badges = getSidebarContractBadges(functions);
      target.innerHTML = badges.map(badge => `
        <span class="contract-identifier-badge ${escapeHtml(badge.id)}" title="${escapeHtml(`${badge.selector} ${badge.signature}`)}">
          ${escapeHtml(badge.label)}
        </span>
      `).join('');
      target.style.display = badges.length > 0 ? 'flex' : 'none';
    }

    function summarizeImplementationDifferences(functions, identifiers = detectContractIdentifiers(functions)) {
      const records = functions || [];
      const knownProtocolSelectors = new Set([
        ...standardFunctionSelectors,
        ...Object.keys(UNISWAP_V4_BASE_HOOK_SELECTORS),
        ...Object.keys(UNISWAP_V4_HOOK_SELECTORS)
      ]);
      const knownProtocolSignatures = new Set([
        ...standardFunctionSignatures,
        ...Object.values(UNISWAP_V4_BASE_HOOK_SELECTORS),
        ...Object.values(UNISWAP_V4_HOOK_SELECTORS)
      ]);
      const customFunctions = records
        .filter(record => {
          const selector = normalizeSelectorId(record?.selector);
          const signature = String(record?.signature || '');
          return selector
            && signature
            && signature !== 'Unknown'
            && !knownProtocolSelectors.has(selector)
            && !knownProtocolSignatures.has(signature);
        })
        .map(record => ({
          selector: normalizeSelectorId(record.selector),
          signature: record.signature,
          mutability: record.mutability || '',
          isRead: !!record.isRead
        }))
        .slice(0, 16);
      const unknownSelectors = records
        .filter(record => record?.isUnknown)
        .map(record => normalizeSelectorId(record.selector))
        .filter(Boolean)
        .slice(0, 12);
      const readCustomFunctions = customFunctions.filter(record => record.isRead).slice(0, 8);
      const writeCustomFunctions = customFunctions.filter(record => !record.isRead).slice(0, 8);
      const uniswapV4Hook = identifiers.find(identifier => identifier.id === 'uniswap_v4_hook') || null;
      const functionNames = new Set(records.map(getFunctionName).filter(Boolean));
      const hasName = (...patterns) => patterns.some(pattern => [...functionNames].some(name => name.includes(pattern)));
      const interpretedUsecase = [];

      if (uniswapV4Hook && hasName('open', 'close', 'fold', 'position')) {
        interpretedUsecase.push('Position lifecycle surface: open/close/fold/position-style functions suggest the hook manages user positions rather than only observing swaps.');
      }
      if (uniswapV4Hook && hasName('debt', 'healthfactor', 'liquidat', 'ltv', 'threshold', 'bonus')) {
        interpretedUsecase.push('Credit/risk surface: debt, health factor, LTV, threshold, bonus, or liquidation functions suggest leveraged or borrow-against-collateral mechanics.');
      }
      if (uniswapV4Hook && hasName('loop', 'maxloops', 'fold')) {
        interpretedUsecase.push('Looping surface: loop/fold/max-loop functions suggest repeated recursive liquidity or leverage steps with an explicit cap.');
      }
      if (uniswapV4Hook && hasName('seed', 'reserve', 'poolkey', 'poolmanager')) {
        interpretedUsecase.push('Pool-engine surface: pool key, reserves, seed liquidity, and PoolManager reads suggest the hook owns pool configuration and internal liquidity accounting.');
      }
      if (uniswapV4Hook && hasName('origfee', 'fee', 'insurance', 'split')) {
        interpretedUsecase.push('Fee/insurance surface: fee and insurance split functions suggest built-in origination or risk-reserve economics.');
      }
      if (uniswapV4Hook && hasName('balanceof', 'setapprovalforall', 'safetransferfrom', 'uri')) {
        interpretedUsecase.push('Receipt-token surface: ERC-1155/ERC-6909-style balance or operator functions suggest positions may be represented as tokenized receipts or IDs.');
      }

      return {
        protocolIdentifiers: identifiers.map(identifier => ({
          id: identifier.id,
          label: identifier.label,
          classification: identifier.classification,
          score: identifier.score,
          reasons: identifier.candidateReasons || [],
          matchedTokenSelectors: identifier.matchedTokenSelectors || [],
          matchedNftSelectors: identifier.matchedNftSelectors || []
        })),
        uniswapV4Hook: uniswapV4Hook ? {
          hookFlags: uniswapV4Hook.hookFlags,
          matchedCallbacks: uniswapV4Hook.matchedHookSelectors,
          matchedSwapCallbacks: uniswapV4Hook.matchedSwapHookSelectors,
          matchedRiskOrControlSelectors: uniswapV4Hook.matchedRiskSelectors,
          hasSwapHookEvidence: uniswapV4Hook.hasSwapHookEvidence
        } : null,
        customFunctionCount: customFunctions.length,
        customFunctions,
        readCustomFunctions,
        writeCustomFunctions,
        interpretedUsecase,
        unknownSelectors,
        note: 'Use this to explain what makes this implementation different from the protocol/base pattern. Treat custom selectors and hook flags as differentiators, not proof of safety or intent.'
      };
    }

    function readResultByName(context, name) {
      const target = String(name || '').toLowerCase();
      const normalizedTarget = normalizeFunctionNameForMatch(target);
      return (context.readResults || []).find(entry => {
        if (!entry?.success) return false;
        const entryName = String(entry?.name || '').split('(')[0].toLowerCase();
        return entryName === target || (!!normalizedTarget && normalizeFunctionNameForMatch(entryName) === normalizedTarget);
      });
    }

    function readResultValue(context, name) {
      const entry = readResultByName(context, name);
      return entry ? String(entry.value ?? '').trim() : '';
    }

    function formatTokenAmount(rawValue, decimalsValue, symbol) {
      const raw = String(rawValue || '').trim();
      const decimalsText = String(decimalsValue || '').trim();
      const cleanInteger = raw.match(/^-?\d+$/)?.[0];
      const decimalsInteger = decimalsText.match(/^\d+$/)?.[0];
      if (!cleanInteger || !decimalsInteger) return raw;

      try {
        const decimals = Number(decimalsInteger);
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return raw;
        const negative = cleanInteger.startsWith('-');
        const digits = negative ? cleanInteger.slice(1) : cleanInteger;
        const padded = digits.padStart(decimals + 1, '0');
        const whole = padded.slice(0, padded.length - decimals) || '0';
        const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, '') : '';
        const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${negative ? '-' : ''}${groupedWhole}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`;
      } catch {
        return raw;
      }
    }

    function percentOfRawTotal(rawValue, totalValue) {
      const raw = String(rawValue || '').trim();
      const total = String(totalValue || '').trim();
      if (!/^\d+$/.test(raw) || !/^\d+$/.test(total)) return '';
      try {
        const rawInt = BigInt(raw);
        const totalInt = BigInt(total);
        if (totalInt <= 0n) return '';
        const basisPoints = (rawInt * 10000n) / totalInt;
        const whole = basisPoints / 100n;
        const fraction = (basisPoints % 100n).toString().padStart(2, '0').replace(/0+$/, '');
        return `${whole.toString()}${fraction ? `.${fraction}` : ''}%`;
      } catch {
        return '';
      }
    }

    function findTokenLimitRead(context, patterns) {
      return (context.readResults || []).find(entry => {
        if (!entry?.success) return false;
        const name = String(entry.name || '').split('(')[0];
        return patterns.some(pattern => functionNameHas(name, pattern));
      });
    }

    function buildDeterministicErc20Summary(context) {
      const identifiers = context.contractIdentifiers || [];
      const profiles = new Set(context.detectedProfiles || []);
      const hasErc20 = identifiers.some(identifier => identifier.id === 'erc20_token');
      const hasConflictingProfile = ['uniswap_v4_hook', 'nft'].some(profile => profiles.has(profile));
      if (!hasErc20 || hasConflictingProfile) return null;

      const name = readResultValue(context, 'name');
      const symbol = readResultValue(context, 'symbol');
      const decimals = readResultValue(context, 'decimals');
      const totalSupplyRaw = readResultValue(context, 'totalSupply');
      const maxSupplyRaw = readResultValue(context, 'maxSupply') || readResultValue(context, 'MAX_SUPPLY');
      const maxWalletEntry = findTokenLimitRead(context, ['maxwallet', 'walletlimit', 'maxhold', 'maxholding']);
      const maxWalletRaw = maxWalletEntry ? String(maxWalletEntry.value ?? '').trim() : '';
      const totalSupply = totalSupplyRaw ? formatTokenAmount(totalSupplyRaw, decimals, symbol) : '';
      const maxSupply = maxSupplyRaw ? formatTokenAmount(maxSupplyRaw, decimals, symbol) : '';
      const maxWallet = maxWalletRaw ? formatTokenAmount(maxWalletRaw, decimals, symbol) : '';
      const maxWalletPercent = maxWalletRaw && totalSupplyRaw ? percentOfRawTotal(maxWalletRaw, totalSupplyRaw) : '';
      const facts = [];

      if (name || symbol) {
        facts.push({
          label: 'Name',
          value: name && symbol ? `${name} (${symbol})` : name || symbol,
          source: [name ? 'name()' : '', symbol ? 'symbol()' : ''].filter(Boolean).join(' + ')
        });
      }
      if (decimals) {
        facts.push({ label: 'Decimals', value: decimals, source: 'decimals()' });
      }
      if (totalSupply && maxSupply && totalSupply.replace(/[,\s]/g, '').toLowerCase() === maxSupply.replace(/[,\s]/g, '').toLowerCase()) {
        facts.push({ label: 'Supply', value: totalSupply, source: 'totalSupply() + maxSupply() + decimals()' });
      } else {
        if (totalSupply) facts.push({ label: 'Total supply', value: totalSupply, source: 'totalSupply() + decimals()' });
        if (maxSupply) facts.push({ label: 'Max supply', value: maxSupply, source: 'maxSupply() + decimals()' });
      }
      if (maxWallet) {
        facts.push({
          label: 'Max wallet',
          value: maxWalletPercent ? `${maxWallet} (${maxWalletPercent} of supply)` : maxWallet,
          source: [maxWalletEntry?.name || 'maxWallet()', totalSupplyRaw ? 'totalSupply()' : '', decimals ? 'decimals()' : ''].filter(Boolean).join(' + ')
        });
      }

      return {
        summary: `${name || symbol || 'This contract'} exposes a standard ERC-20 token surface${totalSupply ? ` with ${totalSupply} supply` : ''}${maxWallet ? ` and a ${maxWalletPercent ? `${maxWalletPercent} ` : ''}max-wallet read` : ''}.`,
        contract_creator: context.contractCreator?.address ? {
          address: context.contractCreator.address,
          label: context.contractCreator.label || 'Contract creator',
          source: context.contractCreator.source || 'explorer'
        } : null,
        facts,
        contract_type: 'erc20_token',
        confidence: 'high',
        key_behaviors: ['Standard ERC-20 metadata, supply, balance, transfer, approval, and allowance functions are present.'],
        implementation_uniqueness: [],
        read_context: maxWallet ? [{
          name: maxWalletEntry?.name || 'maxWallet()',
          value: maxWalletPercent ? `${maxWallet} (${maxWalletPercent} of supply)` : maxWallet,
          meaning: 'Maximum token balance a wallet may be allowed to hold.',
          confidence: 'medium'
        }] : [],
        limits_taxes_and_rules: maxWallet ? [`${maxWalletEntry?.name || 'maxWallet()'} reports ${maxWalletPercent ? `${maxWallet} (${maxWalletPercent} of supply)` : maxWallet}.`] : [],
        privileged_controls: [],
        unknowns: []
      };
    }

    function buildErc20EnrichmentFocus(context) {
      const identifiers = context.contractIdentifiers || [];
      const profiles = new Set(context.detectedProfiles || []);
      const hasErc20 = identifiers.some(identifier => identifier.id === 'erc20_token');
      if (!hasErc20 || profiles.has('uniswap_v4_hook') || profiles.has('nft')) return null;

      const implementation = context.implementationDifferences || {};
      const customFunctions = Array.isArray(implementation.customFunctions) ? implementation.customFunctions : [];
      const unknownSelectors = Array.isArray(implementation.unknownSelectors) ? implementation.unknownSelectors : [];
      const customReads = customFunctions.filter(record => record?.isRead).slice(0, 8);
      const customWrites = customFunctions.filter(record => !record?.isRead).slice(0, 10);
      const interestingProfiles = ['taxed_token', 'launch_sale', 'bonding_curve', 'vault_staking', 'governance', 'router_pool', 'proxy']
        .filter(profile => profiles.has(profile));
      const hasInterestingFunctions = customReads.length > 0 || customWrites.length > 0 || unknownSelectors.length > 0 || interestingProfiles.length > 0;
      if (!hasInterestingFunctions) return null;

      return {
        reason: 'ERC-20 baseline facts are available locally; use the model to interpret uncommon/custom surfaces only.',
        profiles: interestingProfiles,
        customReads,
        customWrites,
        unknownSelectors: unknownSelectors.slice(0, 8),
        instruction: 'Preserve token identity/supply facts from localSummaryBaseline. Explain what the custom read/write functions suggest the token can do, in cautious language based on names, parameters, mutability, and read values.'
      };
    }

    function shouldRequestErc20ModelEnrichment(context) {
      return !!buildErc20EnrichmentFocus(context);
    }

    function formatBasisPoints(rawValue) {
      const text = String(rawValue || '').trim();
      if (!/^-?\d+$/.test(text)) return text;
      const value = Number(text);
      if (!Number.isFinite(value)) return text;
      const percent = value / 100;
      return `${Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
    }

    function detectContractProfiles(functions) {
      const names = new Set((functions || []).map(getFunctionName).filter(Boolean));
      const has = (...candidates) => candidates.some(name => names.has(name) || [...names].some(existing => functionNameHas(existing, name)));
      const profiles = [];
      const identifiers = detectContractIdentifiers(functions);

      if (identifiers.some(identifier => identifier.id === 'erc721_nft')) profiles.push('nft');
      if (identifiers.some(identifier => identifier.id === 'erc20_token')) profiles.push('token');
      if (identifiers.some(identifier => identifier.id === 'uniswap_v4_hook')) profiles.push('uniswap_v4_hook');
      if (has('decimals', 'totalsupply', 'maxsupply', 'totalminted', 'balanceof', 'symbol', 'name', 'transfer')) profiles.push('token');
      if (has('buytax', 'selltax', 'tax', 'fee', 'tradingenabled', 'swapback', 'excludefromfees')) profiles.push('taxed_token');
      if (has('contribute', 'contributionamount', 'maxraise', 'saleend', 'salestart', 'claimallocation', 'refund', 'finalize')) profiles.push('launch_sale');
      if (has('bonding', 'curve', 'quote', 'reserve', 'graduat', 'sqrtprice', 'virtual')) profiles.push('bonding_curve');
      if (has('tokenuri', 'nfttokenuri', 'baseuri', 'tokensofowner', 'royaltyinfo', 'mintprice', 'maxsupply')) profiles.push('nft');
      if (has('deposit', 'withdraw', 'stake', 'unstake', 'reward', 'claimable', 'totalassets', 'asset', 'shares')) profiles.push('vault_staking');
      if (has('router', 'factory', 'pair', 'pool', 'weth', 'poolmanager', 'hook')) profiles.push('router_pool');
      if (has('implementation', 'admin', 'beacon', 'upgrade', 'mastercopy')) profiles.push('proxy');
      if (has('quorum', 'proposal', 'voting', 'timelock', 'delay', 'executor', 'governor')) profiles.push('governance');

      if (profiles.length === 0) profiles.push('unknown');
      return [...new Set(profiles)];
    }

    function getAutoReadLimitForProfiles(profiles) {
      let limit = SUMMARY_MIN_AUTO_READ_LIMIT;
      const profileSet = new Set(profiles || []);
      if (profileSet.has('uniswap_v4_hook')) limit = Math.max(limit, 20);
      if (profileSet.has('token')) limit = Math.max(limit, 15);
      if (profileSet.has('taxed_token') || profileSet.has('launch_sale') || profileSet.has('nft')) limit = Math.max(limit, 15);
      if (profileSet.has('bonding_curve') || profileSet.has('vault_staking') || profileSet.has('governance')) limit = Math.max(limit, 20);
      if (profileSet.size >= 3) limit = Math.max(limit, 18);
      if (profileSet.has('unknown')) limit = Math.max(limit, 12);
      return Math.min(limit, SUMMARY_MAX_AUTO_READ_LIMIT);
    }

    function readPriorityScore(record, profiles) {
      if (!record?.isRead || record.args !== '()' || record.signature === 'Unknown') return -Infinity;
      const name = getFunctionName(record);
      const profileSet = new Set(profiles || []);
      let score = 0;

      const addIf = (weight, ...patterns) => {
        if (patterns.some(pattern => functionNameHas(name, pattern))) score += weight;
      };

      if (name === 'decimals') score += 240;
      if (name === 'symbol' || name === 'name') score += 85;
      addIf(130, 'totalsupply', 'totalminted', 'maxsupply', 'circulatingsupply');
      addIf(125, 'poolmanager', 'gethookpermissions', 'beforeswap', 'afterswap', 'beforeaddliquidity', 'afteraddliquidity', 'beforeremoveliquidity', 'afterremoveliquidity');
      addIf(123, 'origfeebps', 'orig_fee_bps', 'maxloops', 'max_loops', 'loopltvbps', 'loop_ltv_bps', 'liqthresholdbps', 'liq_threshold_bps', 'liqbonusbps', 'liq_bonus_bps', 'insurancesplitbps', 'insurance_split_bps', 'poolkey', 'pool_key', 'reserve');
      addIf(120, 'contributionamount', 'maxraise', 'maxcontributor', 'salestart', 'saleend', 'finalizeallowedat', 'readytofinalize');
      addIf(115, 'buytax', 'selltax', 'tax', 'fee', 'tradingenabled', 'cooldown');
      addIf(70, 'maxwallet', 'walletlimit', 'maxbuytx', 'maxtx', 'maxtransaction');
      addIf(110, 'owner', 'admin', 'operator', 'manager', 'treasury', 'wallet');
      addIf(100, 'router', 'factory', 'pair', 'pool', 'weth', 'token');
      addIf(95, 'paused', 'enabled', 'finalized', 'aborted', 'launched');
      addIf(90, 'min', 'max', 'limit', 'amount', 'cap');
      addIf(85, 'bonding', 'curve', 'reserve', 'quote', 'price', 'supply', 'sqrtprice', 'graduat');
      addIf(80, 'totalassets', 'asset', 'shares', 'reward', 'rate', 'period', 'lock');
      addIf(75, 'tokenuri', 'baseuri', 'maxsupply', 'mintprice', 'royalty');
      addIf(70, 'quorum', 'voting', 'proposal', 'timelock', 'delay');
      addIf(50, 'count', 'total');

      if (profileSet.has('launch_sale')) addIf(80, 'contribution', 'raise', 'sale', 'claim', 'refund', 'finalize', 'abort', 'operator');
      if (profileSet.has('uniswap_v4_hook')) addIf(90, 'hook', 'poolmanager', 'swap', 'liquidity', 'donate', 'tax', 'signer', 'nonce', 'sniper', 'migration', 'loop', 'ltv', 'debt', 'health', 'liquidat', 'position', 'reserve', 'seed', 'fold', 'close', 'open');
      if (profileSet.has('token')) addIf(80, 'decimals', 'supply', 'minted', 'symbol', 'name');
      if (profileSet.has('taxed_token')) addIf(80, 'tax', 'fee', 'trading', 'swap', 'pair', 'router');
      if (profileSet.has('bonding_curve')) addIf(80, 'bonding', 'curve', 'reserve', 'quote', 'price', 'supply', 'sqrt', 'graduat');
      if (profileSet.has('nft')) addIf(70, 'tokenuri', 'baseuri', 'supply', 'mint', 'royalty', 'renderer');
      if (profileSet.has('vault_staking')) addIf(70, 'asset', 'deposit', 'withdraw', 'stake', 'reward', 'claim', 'lock');
      if (profileSet.has('governance')) addIf(70, 'quorum', 'vote', 'proposal', 'delay', 'timelock', 'threshold');
      if (profileSet.has('proxy')) addIf(70, 'implementation', 'admin', 'beacon', 'mastercopy');

      if (name.length <= 4) score -= 15;
      return score;
    }

    function selectSummaryReadCandidates({ reloadContext }) {
      const functions = latestSummaryContextBase?.functions || [];
      const profiles = detectContractProfiles(functions);
      const profileSet = new Set(profiles || []);
      const plainErc20 = profileSet.has('token') && !['uniswap_v4_hook', 'nft', 'taxed_token', 'launch_sale', 'bonding_curve', 'vault_staking', 'governance'].some(profile => profileSet.has(profile));
      const readQueryLimit = plainErc20 && !reloadContext ? 8 : (reloadContext ? SUMMARY_RELOAD_READ_LIMIT : getAutoReadLimitForProfiles(profiles));
      const isTokenLike = profiles.includes('token') || functions.some(record => ['totalsupply', 'maxsupply', 'totalminted', 'balanceof'].includes(getFunctionName(record)));
      const decimalsRecord = functions.find(record => record?.isRead && record.args === '()' && getFunctionName(record) === 'decimals')
        || (isTokenLike ? {
          selector: '0x313ce567',
          args: '()',
          mutability: 'view',
          signature: 'decimals()',
          isRead: true,
          isUnknown: false,
          synthetic: true
        } : null);
      const scored = functions
        .map((record, index) => ({ record, index, score: readPriorityScore(record, profiles) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, readQueryLimit)
        .map(entry => entry.record);
      if (plainErc20) {
        const tokenReadNames = ['name', 'symbol', 'decimals', 'totalsupply', 'maxsupply', 'max_supply', 'owner'];
        const tokenLimitReadPatterns = ['maxwallet', 'walletlimit', 'maxbuytx', 'maxtx', 'maxtransaction'];
        const tokenReads = functions
          .filter(record => {
            if (!record?.isRead || record.args !== '()') return false;
            const name = getFunctionName(record);
            return tokenReadNames.includes(name) || tokenLimitReadPatterns.some(pattern => functionNameHas(name, pattern));
          })
          .map((record, index) => ({ record, index, score: readPriorityScore(record, profiles) }))
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map(entry => entry.record)
          .slice(0, readQueryLimit);
        if (tokenReads.length >= 3) {
          return {
            profiles,
            readQueryLimit,
            candidates: tokenReads
          };
        }
      }
      if (decimalsRecord && !scored.some(record => record.selector === decimalsRecord.selector)) {
        scored.unshift(decimalsRecord);
        scored.splice(readQueryLimit);
      }

      return {
        profiles,
        readQueryLimit,
        candidates: scored
      };
    }

    async function hasOpenRouterApiKey() {
      const response = await chromeMessage({ type: OPENROUTER_STATUS_TYPE });
      return !!response?.ok && !!response.hasKey;
    }

    async function hasCodexLogin() {
      const response = await chromeMessage({ type: CODEX_STATUS_TYPE });
      return !!response?.ok && ['logged_in', 'expired'].includes(response.status);
    }

    function getSummaryProvider() {
      return settings.summaryProvider === 'codex' ? 'codex' : 'openrouter';
    }

    function getSummaryProviderModel(provider = getSummaryProvider()) {
      if (provider !== 'codex') return SUMMARY_MODEL;
      const baseModel = settings.codexFastMode ? CODEX_SUMMARY_PRIORITY_MODEL : CODEX_SUMMARY_MODEL;
      return `${baseModel}:low`;
    }

    function getReadResultStatus(entry) {
      if (entry?.success) return 'success';
      const error = String(entry?.error || '').toLowerCase();
      if (error.includes('timed out')) return 'timeout';
      if (error.includes('revert') || error.includes('execution reverted')) return 'revert';
      return 'failed';
    }

    function groupSummaryReadResults(readResults) {
      return (readResults || []).reduce((groups, entry) => {
        groups[getReadResultStatus(entry)].push(entry);
        return groups;
      }, { success: [], revert: [], timeout: [], failed: [] });
    }

    function encodeByteLength(value) {
      return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
    }

    function rankedFunctionEvidence(functions, profiles) {
      return (functions || [])
        .map((record, index) => ({
          ...record,
          rankScore: readPriorityScore(record, profiles),
          originalIndex: index
        }))
        .sort((a, b) => {
          const knownDelta = Number(a.isUnknown) - Number(b.isUnknown);
          if (knownDelta !== 0) return knownDelta;
          return b.rankScore - a.rankScore || a.originalIndex - b.originalIndex;
        });
    }

    function applySummaryContextBudget(context, budgetBytes = SUMMARY_CONTEXT_BUDGET_BYTES) {
      const diagnostics = {
        contextBudgetBytes: budgetBytes,
        originalBytes: encodeByteLength(context),
        finalBytes: 0,
        truncated: false,
        originalFunctionCount: context.functions?.length || 0,
        finalFunctionCount: context.functions?.length || 0,
        originalVerifiedAbiCount: context.verifiedAbi?.length || 0,
        finalVerifiedAbiCount: context.verifiedAbi?.length || 0
      };

      let next = {
        ...context,
        contextDiagnostics: diagnostics
      };
      if (diagnostics.originalBytes <= budgetBytes) {
        diagnostics.finalBytes = diagnostics.originalBytes;
        return next;
      }

      diagnostics.truncated = true;
      const trimUntilFit = () => encodeByteLength(next) <= budgetBytes;
      const trimList = (key, minLength = 0) => {
        while ((next[key]?.length || 0) > minLength && !trimUntilFit()) {
          next = { ...next, [key]: next[key].slice(0, Math.max(minLength, Math.floor(next[key].length * 0.8))) };
        }
      };

      trimList('verifiedAbi', 40);
      trimList('sourceLinks', 10);
      trimList('functions', 40);
      trimList('rankedFunctions', 40);
      if (!trimUntilFit()) {
        next = {
          ...next,
          contractInfo: String(next.contractInfo || '').slice(0, 1200)
        };
      }
      if (!trimUntilFit()) {
        next = {
          ...next,
          verifiedAbi: [],
          functions: (next.functions || []).slice(0, 40),
          rankedFunctions: (next.rankedFunctions || []).slice(0, 40)
        };
      }

      diagnostics.finalFunctionCount = next.functions?.length || 0;
      diagnostics.finalVerifiedAbiCount = next.verifiedAbi?.length || 0;
      diagnostics.finalBytes = encodeByteLength(next);
      return {
        ...next,
        contextDiagnostics: diagnostics
      };
    }

    function lightSummaryFunctionRecord(record) {
      if (!record || typeof record !== 'object') return null;
      return {
        selector: record.selector || '',
        signature: record.signature || '',
        mutability: record.mutability || '',
        args: record.args || '',
        isRead: !!record.isRead,
        isUnknown: !!record.isUnknown,
        heuristicName: record.heuristicName || '',
        heuristicSource: record.heuristicSource || '',
        heuristicConfidence: record.heuristicConfidence || '',
        rankScore: Number.isFinite(record.rankScore) ? record.rankScore : undefined
      };
    }

    function compactSummaryFunctionList(records, limit) {
      return (records || [])
        .map(lightSummaryFunctionRecord)
        .filter(record => record?.selector || record?.signature)
        .slice(0, limit);
    }

    function isProtocolOrStandardFunction(record) {
      const selector = normalizeSelectorId(record?.selector);
      const signature = String(record?.signature || '');
      return standardFunctionSignatures.includes(signature)
        || standardFunctionSelectors.has(selector)
        || Object.prototype.hasOwnProperty.call(ERC20_TOKEN_SELECTORS, selector)
        || Object.prototype.hasOwnProperty.call(ERC721_NFT_SELECTORS, selector)
        || Object.prototype.hasOwnProperty.call(UNISWAP_V4_BASE_HOOK_SELECTORS, selector)
        || Object.prototype.hasOwnProperty.call(UNISWAP_V4_HOOK_SELECTORS, selector);
    }

    function compactSignature(record) {
      return String(record?.signature || '').slice(0, 140);
    }

    function meaningHintForFunction(record) {
      const name = getFunctionName(record);
      const args = String(record?.args || '');
      const isWrite = !record?.isRead;
      const hints = [];
      const add = (hint, ...patterns) => {
        if (patterns.some(pattern => functionNameHas(name, pattern))) hints.push(hint);
      };

      add('token metadata or supply', 'name', 'symbol', 'decimals', 'totalsupply', 'maxsupply');
      add('balance, allowance, or receipt-token accounting', 'balanceof', 'allowance', 'approve', 'approval', 'operator');
      add('token or position transfer action', 'transfer', 'safetransfer');
      add('ownership/admin control', 'owner', 'admin', 'governor', 'manager', 'operator', 'role');
      add('pausing or launch-state control', 'pause', 'enable', 'disable', 'launch', 'finalize');
      add('fee, tax, or insurance parameter', 'fee', 'tax', 'bps', 'insurance', 'split');
      add('limit, cap, or threshold parameter', 'limit', 'cap', 'threshold', 'max', 'min');
      add('pool configuration or pool accounting', 'pool', 'poolkey', 'poolmanager', 'reserve', 'seed', 'tick', 'sqrt', 'liquidity');
      add('position lifecycle', 'open', 'close', 'position', 'mint', 'burn', 'redeem');
      add('looping or leverage action', 'loop', 'fold', 'leverage');
      add('debt, health, or liquidation logic', 'debt', 'health', 'ltv', 'liquidat', 'collateral');
      add('sale, contribution, or claim flow', 'sale', 'contribution', 'raise', 'claim', 'refund');
      add('price, quote, or curve math', 'price', 'quote', 'curve', 'virtual');
      add('proxy or upgrade surface', 'implementation', 'upgrade', 'beacon');
      if (isWrite && args.includes('address')) hints.push('writes address-linked state');
      if (isWrite && /uint|int/.test(args)) hints.push('writes numeric parameter or amount');
      return [...new Set(hints)].slice(0, 2).join('; ');
    }

    function compactSurfaceFunction(record) {
      return {
        sig: compactSignature(record),
        selector: normalizeSelectorId(record?.selector).slice(0, 10),
        mutability: String(record?.mutability || '').slice(0, 20),
        params: String(record?.args || '').slice(0, 120),
        meaningHint: meaningHintForFunction(record)
      };
    }

    function buildFunctionSurface(context) {
      const records = context.functions || [];
      const known = [];
      const customReads = [];
      const customWrites = [];
      const controls = [];
      const tokenLikeSurface = [];
      const hookSurface = [];
      const unknownSelectors = [];
      const heuristicUnknowns = [];
      const seenKnown = new Set();
      const seenControls = new Set();
      const seenToken = new Set();
      const seenHook = new Set();

      for (const record of records) {
        const selector = normalizeSelectorId(record?.selector);
        const signature = compactSignature(record);
        const name = getFunctionName(record);
        if (!signature || signature === 'Unknown') {
          if (selector) unknownSelectors.push(selector);
          if (selector && record?.heuristicName) {
            heuristicUnknowns.push({
              selector,
              heuristicName: record.heuristicName,
              confidence: record.heuristicConfidence || 'low',
              params: String(record?.args || '').slice(0, 120),
              mutability: String(record?.mutability || '').slice(0, 20)
            });
          }
          continue;
        }

        const isStandard = isProtocolOrStandardFunction(record);
        if (isStandard && !seenKnown.has(signature)) {
          known.push(signature);
          seenKnown.add(signature);
        } else if (!isStandard && record.isRead) {
          customReads.push(compactSurfaceFunction(record));
        } else if (!isStandard) {
          customWrites.push(compactSurfaceFunction(record));
        }

        if (/(owner|admin|operator|role|pause|upgrade|governor|manager|treasury|wallet)/.test(name) && !seenControls.has(signature)) {
          controls.push(compactSurfaceFunction(record));
          seenControls.add(signature);
        }
        if (Object.prototype.hasOwnProperty.call(ERC20_TOKEN_SELECTORS, selector) || Object.prototype.hasOwnProperty.call(ERC721_NFT_SELECTORS, selector) || /(balanceof|allowance|approve|transfer|tokenuri|ownerof|setapprovalforall|isapprovedforall)/.test(name)) {
          if (!seenToken.has(signature)) {
            tokenLikeSurface.push(compactSurfaceFunction(record));
            seenToken.add(signature);
          }
        }
        if (Object.prototype.hasOwnProperty.call(UNISWAP_V4_BASE_HOOK_SELECTORS, selector) || Object.prototype.hasOwnProperty.call(UNISWAP_V4_HOOK_SELECTORS, selector) || /(hook|poolmanager|poolkey|beforeswap|afterswap|liquidity|donate)/.test(name)) {
          if (!seenHook.has(signature)) {
            hookSurface.push(compactSurfaceFunction(record));
            seenHook.add(signature);
          }
        }
      }

      return {
        identifiers: (context.contractIdentifiers || []).map(identifier => identifier.id).filter(Boolean),
        profiles: context.detectedProfiles || [],
        standardSurface: known.slice(0, 32),
        customReads: customReads.slice(0, 18),
        customWrites: customWrites.slice(0, 24),
        controls: controls.slice(0, 10),
        tokenLikeSurface: tokenLikeSurface.slice(0, 16),
        hookSurface: hookSurface.slice(0, 16),
        unknownSelectors: [...new Set(unknownSelectors)].slice(0, 10),
        heuristicUnknowns: heuristicUnknowns.slice(0, 10),
        interpretationHints: Array.isArray(context.implementationDifferences?.interpretedUsecase)
          ? context.implementationDifferences.interpretedUsecase.slice(0, 8)
          : [],
        note: 'Use names, parameter shapes, mutability, and grouping to infer purpose. Read values are optional and only included when they materially identify configuration, limits, addresses, or amounts.'
      };
    }

    function materialReadScore(entry, profiles) {
      if (!entry?.success) return -Infinity;
      const name = String(entry.name || '').split('(')[0].toLowerCase();
      const profileSet = new Set(profiles || []);
      let score = 0;
      const addIf = (weight, ...patterns) => {
        if (patterns.some(pattern => functionNameHas(name, pattern))) score += weight;
      };

      addIf(120, 'poolmanager', 'poolkey', 'owner', 'admin', 'treasury', 'router', 'factory', 'pair', 'weth');
      addIf(115, 'maxloops', 'loopltv', 'liqthreshold', 'liqbonus', 'origfee', 'insurance');
      addIf(105, 'maxsupply', 'totalsupply', 'totalminted', 'decimals', 'symbol', 'name');
      addIf(95, 'tax', 'fee', 'bps', 'limit', 'cap', 'threshold', 'min', 'max');
      addIf(85, 'reserve', 'price', 'quote', 'sqrt', 'tick', 'seed', 'liquidity');
      addIf(75, 'paused', 'enabled', 'finalized', 'sale', 'start', 'end');
      if (profileSet.has('uniswap_v4_hook')) addIf(70, 'loop', 'ltv', 'debt', 'health', 'liquidat', 'position');
      return score;
    }

    function interpretMaterialReadValue(entry) {
      const name = String(entry.name || '').split('(')[0];
      const value = String(entry.value ?? '');
      if (/bps|fee|tax|ltv|threshold|bonus|split/i.test(name) && /^-?\d+$/.test(value)) {
        return formatBasisPoints(value);
      }
      return '';
    }

    function buildMaterialReadValues(context, limit = 10) {
      return (context.readResults || [])
        .map(entry => ({ entry, score: materialReadScore(entry, context.detectedProfiles) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ entry }) => {
          const interpreted = interpretMaterialReadValue(entry);
          return {
            sig: String(entry.name || '').slice(0, 120),
            selector: String(entry.selector || '').slice(0, 10),
            value: String(entry.value ?? '').slice(0, 260),
            interpreted: interpreted || undefined,
            reason: meaningHintForFunction({
              signature: entry.name,
              selector: entry.selector,
              args: '()',
              mutability: 'view',
              isRead: true
            }) || 'material configuration or identifier read'
          };
        });
    }

    function compactImplementationDifferencesForModel(implementationDifferences, { isHook = false } = {}) {
      const source = implementationDifferences && typeof implementationDifferences === 'object' ? implementationDifferences : {};
      return {
        protocolIdentifiers: source.protocolIdentifiers || [],
        uniswapV4Hook: source.uniswapV4Hook || null,
        interpretedUsecase: Array.isArray(source.interpretedUsecase) ? source.interpretedUsecase.slice(0, 8) : [],
        unknownSelectors: Array.isArray(source.unknownSelectors) ? source.unknownSelectors.slice(0, 10) : [],
        note: source.note || ''
      };
    }

    function compactSummaryContextForModel(context, { localSummaryBaseline = null } = {}) {
      const profiles = new Set(context.detectedProfiles || []);
      const isHook = profiles.has('uniswap_v4_hook');
      const erc20EnrichmentFocus = buildErc20EnrichmentFocus(context);
      const compacted = {
        chainHost: context.chainHost,
        pageUrl: context.pageUrl,
        contractAddress: context.contractAddress,
        implementationAddress: context.implementationAddress || '',
        bytecodeSource: context.bytecodeSource || '',
        contractCreator: context.contractCreator || null,
        detectedProfiles: context.detectedProfiles || [],
        contractIdentifiers: context.contractIdentifiers || [],
        functionSurface: buildFunctionSurface(context),
        implementationDifferences: compactImplementationDifferencesForModel(context.implementationDifferences, { isHook }),
        localSummaryBaseline,
        erc20EnrichmentFocus,
        proxyContext: context.proxyContext || null,
        providerContextVersion: context.providerContextVersion || '',
        materialReadValues: buildMaterialReadValues(context, isHook ? 12 : 8),
        sourceLinks: (context.sourceLinks || []).slice(0, 8),
        contractInfo: String(context.contractInfo || '').slice(0, 800)
      };
      return compacted;
    }

    function requestSummaryRead(record, index, { timeoutMs, staggerMs }) {
      return new Promise(resolve => {
        const requestId = `summary-${Date.now()}-${index}-${record.selector.slice(2)}`;
        const timeout = window.setTimeout(() => {
          summaryReadRequests.delete(requestId);
          resolve({
            name: record.signature,
            selector: record.selector,
            success: false,
            error: 'Read query timed out'
          });
        }, timeoutMs);

        summaryReadRequests.set(requestId, payload => {
          window.clearTimeout(timeout);
          resolve({
            name: record.signature,
            selector: record.selector,
            success: !!payload.success,
            value: payload.success ? String(payload.result ?? '') : null,
            error: payload.success ? null : String(payload.error || 'Read query failed')
          });
        });

        window.setTimeout(() => {
          if (!panel.isConnected) {
            summaryReadRequests.delete(requestId);
            window.clearTimeout(timeout);
            resolve({
              name: record.signature,
              selector: record.selector,
              success: false,
              error: 'Panel closed'
            });
            return;
          }

          window.postMessage({
            type: 'QUERY_READ_FUNCTION',
            purpose: SUMMARY_READ_PURPOSE,
            requestId,
            selector: record.selector,
            signature: record.signature,
            contractAddress
          }, '*');
        }, index * staggerMs);
      });
    }

    async function buildSummaryContext({ reloadContext = false } = {}) {
      if (!latestSummaryContextBase) {
        throw new Error('Function context is not ready yet.');
      }

      const selection = selectSummaryReadCandidates({ reloadContext });
      const readQueryLimit = selection.readQueryLimit;
      const readTimeoutMs = reloadContext ? SUMMARY_RELOAD_READ_TIMEOUT_MS : SUMMARY_AUTO_READ_TIMEOUT_MS;
      const readStaggerMs = reloadContext ? SUMMARY_RELOAD_READ_STAGGER_MS : SUMMARY_AUTO_READ_STAGGER_MS;
      const readCandidates = selection.candidates;
      const readResults = await Promise.all(readCandidates.map((record, index) => requestSummaryRead(record, index, {
        timeoutMs: readTimeoutMs,
        staggerMs: readStaggerMs
      })));
      const readResultsGrouped = groupSummaryReadResults(readResults);
      const rankedFunctions = rankedFunctionEvidence(latestSummaryContextBase.functions || [], selection.profiles);
      const contractCreator = getContractCreatorInfo();
      const contractIdentifiers = detectContractIdentifiers(latestSummaryContextBase.functions || []);
      const implementationDifferences = summarizeImplementationDifferences(latestSummaryContextBase.functions || [], contractIdentifiers);

      const context = {
        ...latestSummaryContextBase,
        sourceLinks: (panel.getAllDiscoveredLinks?.() || getContractSourceLinks()).slice(0, 30),
        contractInfo: getContractInfoText(),
        contractCreator,
        contractIdentifiers,
        implementationDifferences,
        detectedProfiles: selection.profiles,
        providerContextVersion: 'function-evidence-v1',
        proxyContext: {
          implementationAddress: latestSummaryContextBase.implementationAddress || null,
          bytecodeSource: latestSummaryContextBase.bytecodeSource || null
        },
        rankedFunctions,
        readQueryMode: 'profile-scored high-signal no-arg view/pure reads only',
        readQueryLimit,
        readQuerySelected: readCandidates.length,
        readQueryTimeoutMs: readTimeoutMs,
        reloadContext: !!reloadContext,
        readResults,
        readResultsGrouped,
        readResultCounts: {
          success: readResultsGrouped.success.length,
          revert: readResultsGrouped.revert.length,
          timeout: readResultsGrouped.timeout.length,
          failed: readResultsGrouped.failed.length
        }
      };
      const budgetedContext = applySummaryContextBudget(context);
      const contextHash = await sha256Hex(stableStringify({
        chainHost: budgetedContext.chainHost,
        contractAddress: budgetedContext.contractAddress,
        implementationAddress: budgetedContext.implementationAddress || null,
        bytecodeSource: budgetedContext.bytecodeSource || null,
        functions: budgetedContext.functions,
        verifiedAbiHash: budgetedContext.verifiedAbiHash || null,
        contractInfo: budgetedContext.contractInfo,
        contractCreator: budgetedContext.contractCreator || null,
        sourceLinks: budgetedContext.sourceLinks
      }));

      return { context: budgetedContext, contextHash };
    }

    async function buildChatContext() {
      if (!latestSummaryContextBase) {
        throw new Error('Function context is not ready yet.');
      }

      return {
        ...latestSummaryContextBase,
        sourceLinks: (panel.getAllDiscoveredLinks?.() || getContractSourceLinks()).slice(0, 20),
        contractInfo: getContractInfoText(),
        contractCreator: getContractCreatorInfo(),
        currentSummary: latestSummaryResult?.summary || null,
        note: 'Chat context includes parsed function surface and current summary. It does not auto-query additional parameterized reads.'
      };
    }

    function parseSelectorDetail(selectorText) {
      if (typeof selectorText !== 'string') return null;
      const [selectorInfo, signatureInfo] = selectorText.split('\n');
      if (!selectorInfo || !signatureInfo) return null;
      const separatorIndex = selectorInfo.indexOf(': ');
      if (separatorIndex === -1) return null;
      const selector = selectorInfo.slice(0, separatorIndex).trim();
      const argsAndMutability = selectorInfo.slice(separatorIndex + 2).trim();
      const mutabilityMatch = argsAndMutability.match(/\s+(\S+)$/);
      if (!selector || !mutabilityMatch) return null;
      const args = argsAndMutability.slice(0, mutabilityMatch.index).trim();
      const mutability = mutabilityMatch[1];
      const signature = signatureInfo.trim();
      const isRead = mutability === 'view' || mutability === 'pure';
      return {
        selector,
        args,
        mutability,
        signature,
        isRead,
        isUnknown: signature === 'Unknown'
      };
    }

    function extractMentionedAddressKeys(question) {
      const addressMatches = [...String(question || '').matchAll(/@\(?\s*(0x[a-fA-F0-9]{40})\s*\)?/g)];
      const keys = [];
      const seen = new Set();
      addressMatches.forEach(match => {
        const key = normalizeAddressKey(match[1]);
        if (key && !seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      });
      return keys;
    }

    function compactMentionSummary(summary) {
      if (!summary || typeof summary !== 'object') return null;
      return {
        summary: String(summary.summary || '').slice(0, 500),
        contractType: String(summary.contract_type || '').slice(0, 80),
        confidence: String(summary.confidence || '').slice(0, 20),
        contractCreator: summary.contract_creator?.address
          ? {
            label: String(summary.contract_creator.label || 'Contract creator').slice(0, 80),
            address: String(summary.contract_creator.address || '').slice(0, 60),
            source: String(summary.contract_creator.source || 'summary-cache').slice(0, 80)
          }
          : null,
        facts: compactSummaryFacts(summary)
      };
    }

    async function fetchContractSummaryForAddress(address) {
      const cached = await fetchContractSummaryCache(settings, {
        chainHost: window.location.hostname,
        contractAddress: address
      });
      const summary = cached?.summary_json || cached?.summary || cached;
      return compactMentionSummary(summary);
    }

    async function fetchContractCreatorForAddress(address) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3500);
      try {
        const response = await fetch(getExplorerAddressUrl(address), {
          headers: { 'Accept': 'text/html' },
          signal: controller.signal
        });
        if (!response.ok) return null;
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const creator = getContractCreatorInfo(doc);
        return creator
          ? {
            ...creator,
            source: 'explorer-address-page'
          }
          : null;
      } catch (e) {
        return null;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    function requestMentionedContractAnalysis(address) {
      return new Promise(resolve => {
        const requestId = `mentioned-contract-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const timeout = window.setTimeout(() => {
          contractMentionAnalysisRequests.delete(requestId);
          resolve({
            success: false,
            contractAddress: address,
            error: 'Mentioned contract analysis timed out'
          });
        }, MENTIONED_CONTRACT_ANALYSIS_TIMEOUT_MS);

        contractMentionAnalysisRequests.set(requestId, payload => {
          window.clearTimeout(timeout);
          resolve(payload);
        });

        window.postMessage({
          type: 'ANALYZE_CONTRACT_ADDRESS',
          requestId,
          contractAddress: address
        }, '*');
      });
    }

    async function buildMentionedContractContext(address, currentCreator) {
      const [analysis, cachedSummary, fetchedCreator] = await Promise.all([
        requestMentionedContractAnalysis(address),
        fetchContractSummaryForAddress(address).catch(() => null),
        fetchContractCreatorForAddress(address).catch(() => null)
      ]);
      const parsedFunctions = Array.isArray(analysis?.selectors)
        ? analysis.selectors.map(parseSelectorDetail).filter(Boolean)
        : [];
      const mentionedCreator = cachedSummary?.contractCreator || fetchedCreator || null;
      const currentCreatorAddress = currentCreator?.address || '';
      const sameCreator = currentCreatorAddress && mentionedCreator?.address
        ? normalizeAddressKey(currentCreatorAddress) === normalizeAddressKey(mentionedCreator.address)
        : null;

      return {
        chainHost: window.location.hostname,
        pageUrl: getExplorerAddressUrl(address),
        contractAddress: address,
        implementationAddress: analysis?.implementationAddress || null,
        implementationPath: Array.isArray(analysis?.implementationPath) ? analysis.implementationPath : [],
        bytecodeSource: analysis?.bytecodeSource || null,
        analysisStatus: analysis?.success ? 'ok' : 'error',
        analysisError: analysis?.success ? null : String(analysis?.error || 'Analysis failed').slice(0, 240),
        contractCreator: mentionedCreator,
        creatorComparison: {
          currentCreator: currentCreator || null,
          mentionedCreator,
          sameCreator,
          note: sameCreator === false
            ? 'Mentioned contract has a different creator/deployer than the current contract in supplied evidence.'
            : (sameCreator === true ? 'Mentioned contract has the same creator/deployer as the current contract in supplied evidence.' : 'Creator/deployer comparison is unknown from supplied evidence.')
        },
        cachedSummary: cachedSummary
          ? {
            summary: cachedSummary.summary,
            contractType: cachedSummary.contractType,
            confidence: cachedSummary.confidence,
            facts: cachedSummary.facts
          }
          : null,
        counts: {
          functions: parsedFunctions.length,
          read: parsedFunctions.filter(record => record.isRead).length,
          write: parsedFunctions.filter(record => !record.isRead).length,
          unknown: parsedFunctions.filter(record => record.isUnknown).length
        },
        functions: parsedFunctions.slice(0, 120),
        note: 'Mentioned contract context is fetched by address from same-chain RPC. Summary comes from cached evidence when available; deployer evidence comes from cache or the explorer address page.'
      };
    }

    function normalizeAddressKey(address) {
      return String(address || '').toLowerCase();
    }

    function relatedContractStorageKey(record) {
      return `${String(record?.chainHost || '').toLowerCase()}:${normalizeAddressKey(record?.contractAddress)}`;
    }

    function compactSummaryFacts(summary) {
      return Array.isArray(summary?.facts)
        ? summary.facts.slice(0, 4).map(fact => ({
          label: String(fact?.label || '').slice(0, 80),
          value: String(fact?.value || '').slice(0, 160),
          source: String(fact?.source || '').slice(0, 100)
        })).filter(fact => fact.label || fact.value)
        : [];
    }

    function buildCurrentRelatedContractRecord(summary = latestSummaryResult?.summary || null) {
      const creator = getContractCreatorInfo();
      if (!creator?.address || !contractAddress) return null;

      return {
        chainHost: window.location.hostname,
        pageUrl: window.location.href,
        contractAddress,
        implementationAddress: latestSummaryContextBase?.implementationAddress || null,
        contractCreator: creator,
        contractType: String(summary?.contract_type || '').slice(0, 80),
        confidence: String(summary?.confidence || '').slice(0, 20),
        summary: String(summary?.summary || '').slice(0, 500),
        facts: compactSummaryFacts(summary),
        counts: latestSummaryContextBase?.counts || null,
        updatedAt: Date.now()
      };
    }

    function mapSummaryRowToRelatedContract(row) {
      const summary = row?.summary_json || row?.summary || {};
      const creatorAddress = summary?.contract_creator?.address || row?.creator_address || '';
      return {
        chainHost: row?.chain_host || row?.chainHost || '',
        pageUrl: row?.page_url || '',
        contractAddress: row?.contract_address || row?.contractAddress || '',
        implementationAddress: row?.implementation_address || row?.implementationAddress || null,
        contractCreator: creatorAddress
          ? {
            label: 'Contract creator',
            address: creatorAddress,
            source: 'signature-db'
          }
          : null,
        contractType: String(summary?.contract_type || '').slice(0, 80),
        confidence: String(summary?.confidence || '').slice(0, 20),
        summary: String(summary?.summary || '').slice(0, 500),
        facts: compactSummaryFacts(summary),
        counts: null,
        model: row?.model || '',
        promptVersion: row?.prompt_version || row?.promptVersion || '',
        updatedAt: row?.updated_at ? Date.parse(row.updated_at) || 0 : Date.now()
      };
    }

    function mergeRelatedContracts(...groups) {
      const records = groups.flat().filter(record => record?.contractAddress);
      const byKey = new Map();
      records.forEach(record => {
        const key = relatedContractStorageKey(record);
        const existing = byKey.get(key);
        if (!existing || Number(record.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
          byKey.set(key, record);
        }
      });

      return [...byKey.values()]
        .filter(record => {
          const sameAddress = normalizeAddressKey(record.contractAddress) === normalizeAddressKey(contractAddress);
          const sameHost = String(record.chainHost || '').toLowerCase() === window.location.hostname.toLowerCase();
          return !(sameAddress && sameHost);
        })
        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
        .slice(0, RELATED_CONTRACTS_CHAT_LIMIT);
    }

    async function readRelatedContractIndex() {
      const values = await localStorageGet({ [RELATED_CONTRACTS_STORAGE_KEY]: {} });
      const index = values[RELATED_CONTRACTS_STORAGE_KEY];
      return index && typeof index === 'object' && !Array.isArray(index) ? index : {};
    }

    async function writeRelatedContractIndex(index) {
      await localStorageSet({ [RELATED_CONTRACTS_STORAGE_KEY]: index });
    }

    function trimRelatedContractIndex(index) {
      const creatorEntries = Object.entries(index)
        .map(([creatorKey, bucket]) => {
          const contracts = bucket?.contracts && typeof bucket.contracts === 'object' ? bucket.contracts : {};
          const latestUpdatedAt = Math.max(0, ...Object.values(contracts).map(record => Number(record?.updatedAt || 0)));
          return [creatorKey, { ...bucket, contracts, latestUpdatedAt }];
        })
        .sort((a, b) => b[1].latestUpdatedAt - a[1].latestUpdatedAt)
        .slice(0, RELATED_CONTRACTS_MAX_CREATORS);

      return creatorEntries.reduce((next, [creatorKey, bucket]) => {
        const contracts = Object.entries(bucket.contracts)
          .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
          .slice(0, RELATED_CONTRACTS_MAX_PER_CREATOR)
          .reduce((acc, [contractKey, record]) => {
            acc[contractKey] = record;
            return acc;
          }, {});
        next[creatorKey] = {
          creatorAddress: bucket.creatorAddress || '',
          contracts
        };
        return next;
      }, {});
    }

    async function rememberCurrentRelatedContract(summary = latestSummaryResult?.summary || null) {
      const record = buildCurrentRelatedContractRecord(summary);
      if (!record) return;

      try {
        const creatorKey = normalizeAddressKey(record.contractCreator.address);
        const index = await readRelatedContractIndex();
        const bucket = index[creatorKey] || {
          creatorAddress: record.contractCreator.address,
          contracts: {}
        };
        const contractKey = relatedContractStorageKey(record);
        bucket.creatorAddress = record.contractCreator.address;
        bucket.contracts = {
          ...(bucket.contracts || {}),
          [contractKey]: {
            ...(bucket.contracts?.[contractKey] || {}),
            ...record
          }
        };
        index[creatorKey] = bucket;
        await writeRelatedContractIndex(trimRelatedContractIndex(index));
        relatedContractsForCreator = await getRelatedContractsForCurrentCreator();
      } catch (error) {
        console.log('Related contract index update error:', error?.message || error);
      }
    }

    async function getRelatedContractsForCurrentCreator() {
      const creator = getContractCreatorInfo();
      if (!creator?.address) return [];

      const index = await readRelatedContractIndex();
      const bucket = index[normalizeAddressKey(creator.address)];
      const localContracts = bucket?.contracts && typeof bucket.contracts === 'object'
        ? Object.values(bucket.contracts)
        : [];
      const dbContracts = (await fetchContractSummariesByCreator(settings, {
        chainHost: window.location.hostname,
        creatorAddress: creator.address,
        excludeContractAddress: contractAddress,
        limit: RELATED_CONTRACTS_CHAT_LIMIT
      })).map(mapSummaryRowToRelatedContract);

      return mergeRelatedContracts(dbContracts, localContracts);
    }

    function formatRelatedContractLabel(record) {
      const type = String(record?.contractType || '').trim();
      return type && type !== 'unknown' ? type : 'contract';
    }

    function renderMentionAddress(address) {
      return truncateAddress(String(address || ''));
    }

    function getActiveMentionRange(input) {
      const cursor = input.selectionStart ?? input.value.length;
      const beforeCursor = input.value.slice(0, cursor);
      const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9]*)$/);
      if (!match) return null;
      const prefixLength = match[1].length;
      return {
        start: beforeCursor.length - match[2].length - 1,
        end: cursor,
        query: match[2].toLowerCase(),
        prefixLength
      };
    }

    function filterMentionContracts(query) {
      const needle = String(query || '').toLowerCase();
      return relatedContractsForCreator.filter(record => {
        if (!needle) return true;
        return normalizeAddressKey(record.contractAddress).includes(needle)
          || String(record.contractType || '').toLowerCase().includes(needle)
          || String(record.summary || '').toLowerCase().includes(needle);
      }).slice(0, RELATED_CONTRACTS_CHAT_LIMIT);
    }

    function hideMentionMenu() {
      const menu = chatPanel.querySelector('.evmole-chat-mention-menu');
      if (!menu) return;
      menu.classList.remove('open');
      menu.innerHTML = '';
      activeMentionRange = null;
      activeMentionSelection = 0;
    }

    function updateMentionMenuSelection(menu) {
      const items = Array.from(menu.querySelectorAll('.evmole-chat-mention-item'));
      items.forEach((item, index) => {
        item.classList.toggle('selected', index === activeMentionSelection);
        item.setAttribute('aria-selected', index === activeMentionSelection ? 'true' : 'false');
      });
    }

    function insertMention(record) {
      const input = chatPanel.querySelector('.evmole-chat-input');
      if (!input || !activeMentionRange) return;
      const before = input.value.slice(0, activeMentionRange.start);
      const after = input.value.slice(activeMentionRange.end);
      const mention = `@${record.contractAddress}`;
      input.value = `${before}${mention} ${after}`;
      const cursor = before.length + mention.length + 1;
      input.focus();
      input.setSelectionRange(cursor, cursor);
      hideMentionMenu();
    }

    function insertAllMentions() {
      const input = chatPanel.querySelector('.evmole-chat-input');
      if (!input || !activeMentionRange) return;
      const before = input.value.slice(0, activeMentionRange.start);
      const after = input.value.slice(activeMentionRange.end);
      const mention = '@all-related';
      input.value = `${before}${mention} ${after}`;
      const cursor = before.length + mention.length + 1;
      input.focus();
      input.setSelectionRange(cursor, cursor);
      hideMentionMenu();
    }

    async function refreshMentionMenu() {
      const input = chatPanel.querySelector('.evmole-chat-input');
      const menu = chatPanel.querySelector('.evmole-chat-mention-menu');
      if (!input || !menu) return;

      if (relatedContractsForCreator.length === 0) {
        relatedContractsForCreator = await getRelatedContractsForCurrentCreator().catch(() => []);
      }

      const range = getActiveMentionRange(input);
      if (!range || relatedContractsForCreator.length === 0) {
        hideMentionMenu();
        return;
      }

      const matches = filterMentionContracts(range.query);
      if (matches.length === 0) {
        hideMentionMenu();
        return;
      }

      activeMentionRange = range;
      const showAllOption = relatedContractsForCreator.length > 1 && (!range.query || 'all-related'.includes(range.query));
      const optionCount = matches.length + (showAllOption ? 1 : 0);
      activeMentionSelection = Math.min(activeMentionSelection, optionCount - 1);
      const allOptionHtml = showAllOption ? `
        <button class="evmole-chat-mention-item all-related" type="button" role="option" aria-selected="${activeMentionSelection === 0 ? 'true' : 'false'}" data-mention-action="all">
          <span class="evmole-chat-mention-address">@all-related</span>
          <span class="evmole-chat-mention-meta">${relatedContractsForCreator.length} same-deployer contracts</span>
          <span class="evmole-chat-mention-summary">Include all available related contracts in chat context</span>
        </button>
      ` : '';
      menu.innerHTML = `${allOptionHtml}${matches.map((record, index) => {
        const selectionIndex = index + (showAllOption ? 1 : 0);
        return `
        <button class="evmole-chat-mention-item" type="button" role="option" aria-selected="${selectionIndex === activeMentionSelection ? 'true' : 'false'}" data-contract-address="${escapeHtml(record.contractAddress)}">
          <span class="evmole-chat-mention-address">${escapeHtml(renderMentionAddress(record.contractAddress))}</span>
          <span class="evmole-chat-mention-meta">${escapeHtml(record.chainHost || '')} · ${escapeHtml(formatRelatedContractLabel(record))}</span>
          ${record.summary ? `<span class="evmole-chat-mention-summary">${escapeHtml(record.summary)}</span>` : ''}
        </button>
      `;
      }).join('')}`;
      menu.classList.add('open');
      updateMentionMenuSelection(menu);
    }

    function getMentionMenuMatches() {
      if (!activeMentionRange) return [];
      const matches = filterMentionContracts(activeMentionRange.query);
      if (relatedContractsForCreator.length > 1 && (!activeMentionRange.query || 'all-related'.includes(activeMentionRange.query))) {
        return [{ allRelated: true }, ...matches];
      }
      return matches;
    }

    function extractMentionedRelatedContracts(question, relatedContracts) {
      if (/@all-related\b/i.test(String(question || ''))) {
        return relatedContracts.slice(0, RELATED_CONTRACTS_CHAT_LIMIT);
      }
      const mentionedAddresses = new Set(extractMentionedAddressKeys(question));
      return relatedContracts.filter(record => mentionedAddresses.has(normalizeAddressKey(record.contractAddress)));
    }

    function isCrossContractQuestion(question) {
      return /@all-related\b/i.test(String(question || ''))
        || extractMentionedAddressKeys(question).length > 0
        || /\b(?:same\s+deployer|same\s+creator|creator|deployer|related\s+contracts?|other\s+contracts?|integrat(?:e|ed|ion)|big\s+picture|ecosystem|suite|similarit(?:y|ies)|differences?|compare)\b/i.test(question);
    }

    async function buildSummaryCacheParams() {
      if (!latestSummaryContextBase) {
        throw new Error('Function context is not ready yet.');
      }

      const baseContext = {
        ...latestSummaryContextBase,
        sourceLinks: (panel.getAllDiscoveredLinks?.() || getContractSourceLinks()).slice(0, 30),
        contractInfo: getContractInfoText(),
        contractCreator: getContractCreatorInfo()
      };
      const hashPayload = {
        chainHost: baseContext.chainHost,
        contractAddress: baseContext.contractAddress,
        implementationAddress: baseContext.implementationAddress || null,
        bytecodeSource: baseContext.bytecodeSource || null,
        functions: baseContext.functions,
        verifiedAbiHash: baseContext.verifiedAbiHash || null,
        contractInfo: baseContext.contractInfo,
        contractCreator: baseContext.contractCreator || null,
        sourceLinks: baseContext.sourceLinks
      };
      const contextHash = await sha256Hex(stableStringify(hashPayload));
      return {
        chainHost: baseContext.chainHost,
        contractAddress: baseContext.contractAddress,
        implementationAddress: baseContext.implementationAddress || '',
        contextHash,
        model: getSummaryProviderModel(),
        promptVersion: SUMMARY_PROMPT_VERSION
      };
    }

    async function hydrateCachedSummary() {
      if (!latestSummaryContextBase || latestSummaryResult) return;

      try {
        const cacheParams = await buildSummaryCacheParams();
        const hydrationKey = stableStringify(cacheParams);
        if (autoSummaryHydrationKey === hydrationKey) return;
        autoSummaryHydrationKey = hydrationKey;
        setSummaryState(summaryPanel, 'loading', { message: 'Checking cached summary...' });

        const cached = await fetchContractSummaryCache(settings, cacheParams);

        if (!cached?.summary_json || latestSummaryResult) return;

        latestSummaryResult = { source: 'cached', summary: cached.summary_json };
        setSummaryState(summaryPanel, 'cached', {
          message: 'Cached summary',
          summary: cached.summary_json
        });
        rememberCurrentRelatedContract(cached.summary_json);
      } catch (e) {
        console.log('Cached summary hydration error:', e?.message || e);
      } finally {
        if (!latestSummaryResult) {
          summaryCacheMissKey = autoSummaryHydrationKey;
          setSummaryState(summaryPanel, 'idle');
          maybeAutoGenerateSummary();
        }
      }
    }

    async function maybeAutoGenerateSummary() {
      if (autoSummaryAttempted || latestSummaryResult || !latestSummaryContextBase) return;

      autoSummaryAttempted = true;
      try {
        if (getSummaryProvider() === 'codex') {
          if (!await hasCodexLogin()) return;
        } else if (!await hasOpenRouterApiKey()) {
          return;
        }
        await generateContractSummary({ bypassCache: false, reloadContext: false, automatic: true });
      } catch (e) {
        console.log('Auto summary error:', e?.message || e);
      }
    }

    async function generateContractSummary({ bypassCache = false, reloadContext = false, automatic = false } = {}) {
      const startedAt = performance.now();
      const timing = {
        cacheMs: 0,
        contextMs: 0,
        modelMs: 0,
        storeCacheMs: 0
      };
      let visibleFallbackSummary = null;
      try {
        const selectedProvider = getSummaryProvider();
        setSummaryState(summaryPanel, 'loading', { message: automatic ? 'Auto summarizing...' : (reloadContext ? 'Reloading context...' : 'Building context...') });
        let cacheParams = null;
        if (!bypassCache && !reloadContext) {
          const cacheStartedAt = performance.now();
          cacheParams = await buildSummaryCacheParams();
          const cacheKey = stableStringify(cacheParams);
          if (summaryCacheMissKey !== cacheKey) {
            const cached = await fetchContractSummaryCache(settings, cacheParams);
            timing.cacheMs = performance.now() - cacheStartedAt;
            if (cached?.summary_json) {
              latestSummaryResult = { source: 'cached', summary: cached.summary_json };
              setSummaryState(summaryPanel, 'cached', {
                message: 'Cached summary',
                summary: cached.summary_json
              });
              rememberCurrentRelatedContract(cached.summary_json);
              return;
            }
            summaryCacheMissKey = cacheKey;
          } else {
            timing.cacheMs = performance.now() - cacheStartedAt;
          }
        }

        const contextStartedAt = performance.now();
        const { context, contextHash } = await buildSummaryContext({ reloadContext });
        timing.contextMs = performance.now() - contextStartedAt;
        cacheParams = {
          chainHost: context.chainHost,
          contractAddress: context.contractAddress,
          implementationAddress: context.implementationAddress || '',
          contextHash,
          model: getSummaryProviderModel(selectedProvider),
          promptVersion: SUMMARY_PROMPT_VERSION
        };

        const deterministicSummary = buildDeterministicErc20Summary(context);
        const shouldEnrichErc20 = deterministicSummary && shouldRequestErc20ModelEnrichment(context);
        if (deterministicSummary && !shouldEnrichErc20) {
          latestSummaryResult = { source: 'generated', summary: deterministicSummary };
          setSummaryState(summaryPanel, 'generated', {
            message: `Generated summary ${formatElapsedTime(performance.now() - startedAt)} (local)`,
            summary: deterministicSummary
          });
          rememberCurrentRelatedContract(deterministicSummary);

          const storeStartedAt = performance.now();
          await storeContractSummaryCache(settings, {
            ...cacheParams,
            chainHost: context.chainHost,
            contractAddress: context.contractAddress,
            implementationAddress: context.implementationAddress || null,
            creatorAddress: context.contractCreator?.address || null,
            summary: deterministicSummary
          });
          timing.storeCacheMs = performance.now() - storeStartedAt;
          return;
        }

        if (deterministicSummary && shouldEnrichErc20) {
          visibleFallbackSummary = deterministicSummary;
          latestSummaryResult = { source: 'generated', summary: deterministicSummary };
          setSummaryState(summaryPanel, 'loading', {
            message: `Generated summary ${formatElapsedTime(performance.now() - startedAt)} (local). Asking ${selectedProvider === 'codex' ? 'Codex' : 'OpenRouter'} for custom function context...`,
            summary: deterministicSummary
          });
          rememberCurrentRelatedContract(deterministicSummary);
        }

        const modelContext = compactSummaryContextForModel(context, {
          localSummaryBaseline: visibleFallbackSummary
        });
        const modelContextBytes = encodeByteLength(modelContext);
        const modelContextDiagnostics = {
          bytes: modelContextBytes,
          profiles: modelContext.detectedProfiles || [],
          standardSurface: modelContext.functionSurface?.standardSurface?.length || 0,
          customReads: modelContext.functionSurface?.customReads?.length || 0,
          customWrites: modelContext.functionSurface?.customWrites?.length || 0,
          controls: modelContext.functionSurface?.controls?.length || 0,
          tokenLikeSurface: modelContext.functionSurface?.tokenLikeSurface?.length || 0,
          hookSurface: modelContext.functionSurface?.hookSurface?.length || 0,
          materialReadValues: modelContext.materialReadValues?.length || 0,
          sourceLinks: modelContext.sourceLinks?.length || 0,
          contractInfoChars: String(modelContext.contractInfo || '').length
        };
        if (!visibleFallbackSummary) {
          setSummaryState(summaryPanel, 'loading', { message: selectedProvider === 'codex' ? 'Asking Codex...' : 'Asking OpenRouter...' });
        }
        const modelStartedAt = performance.now();
        let response;
        let providerUsed = selectedProvider;
        if (selectedProvider === 'codex') {
          response = await chromeMessage({
            type: CODEX_SUMMARY_TYPE,
            context: modelContext,
            fastMode: !!settings.codexFastMode,
            reasoningEffort: 'low',
            dedupeKey: stableStringify(cacheParams)
          });
        } else {
          response = await chromeMessage({
            type: OPENROUTER_SUMMARY_TYPE,
            context: modelContext,
            dedupeKey: stableStringify(cacheParams)
          });
        }
        timing.modelMs = performance.now() - modelStartedAt;

        if (!response?.ok) {
          const error = new Error(response?.error || `${providerUsed === 'codex' ? 'Codex' : 'OpenRouter'} summary failed.`);
          if (response?.contextInvalidated) error.contextInvalidated = true;
          throw error;
        }

        latestSummaryResult = { source: 'generated', summary: response.summary };
        const providerTimingLabel = formatSummaryProviderTiming(providerUsed, response, timing.modelMs);
        setSummaryState(summaryPanel, 'generated', {
          message: `Generated summary ${formatElapsedTime(performance.now() - startedAt)} (${providerTimingLabel})`,
          summary: response.summary
        });
        rememberCurrentRelatedContract(response.summary);

        const storeStartedAt = performance.now();
        await storeContractSummaryCache(settings, {
          ...cacheParams,
          chainHost: context.chainHost,
          contractAddress: context.contractAddress,
          implementationAddress: context.implementationAddress || null,
          creatorAddress: context.contractCreator?.address || null,
          summary: response.summary
        });
        timing.storeCacheMs = performance.now() - storeStartedAt;

        console.info('Evmole summary timing:', {
          totalMs: Math.round(performance.now() - startedAt),
          cacheMs: Math.round(timing.cacheMs),
          contextMs: Math.round(timing.contextMs),
          modelMs: Math.round(timing.modelMs),
          storeCacheMs: Math.round(timing.storeCacheMs),
          selectedProvider,
          providerUsed,
          readQuerySelected: context.readQuerySelected,
          readQueryTimeoutMs: context.readQueryTimeoutMs,
          readResults: {
            success: context.readResults.filter(entry => entry.success).length,
            failed: context.readResults.filter(entry => !entry.success).length
          },
          contextDiagnostics: context.contextDiagnostics || null,
          functions: context.counts,
          providerTiming: response.timing || null,
          modelContext: modelContextDiagnostics,
          usage: response.usage || null
        });
      } catch (error) {
        if (visibleFallbackSummary) {
          latestSummaryResult = { source: 'generated', summary: visibleFallbackSummary };
          setSummaryState(summaryPanel, 'generated', {
            message: `Generated summary ${formatElapsedTime(performance.now() - startedAt)} (local; model enrichment failed)`,
            summary: visibleFallbackSummary
          });
          return;
        }
        setSummaryState(summaryPanel, 'error', {
          message: error?.message || String(error),
          contextInvalidated: !!error?.contextInvalidated || /extension context invalidated|runtime is unavailable/i.test(String(error?.message || error))
        });
      }
    }

    function setChatOpen(open) {
      chatPanel.classList.toggle('open', open);
      if (open) {
        chatPanel.querySelector('.evmole-chat-input')?.focus();
      }
    }

    function appendChatMessage(role, content, { loading = false } = {}) {
      const log = chatPanel.querySelector('.evmole-chat-log');
      log.querySelector('.evmole-chat-empty')?.remove();
      const item = document.createElement('div');
      item.className = `evmole-chat-message ${role}${loading ? ' loading' : ''}`;
      item.innerHTML = renderChatText(content);
      log.appendChild(item);
      log.scrollTop = log.scrollHeight;
      return item;
    }

    function extractTokenId(question) {
      const text = String(question || '');
      const specific = text.match(/\btoken(?:\s*id)?\s*(?:#|:|=)?\s*(\d+)\b/i)
        || text.match(/#\s*(\d+)\b/)
        || text.match(/\bid\s*(?:#|:|=)?\s*(\d+)\b/i);
      if (specific) return specific[1];
      const generic = text.match(/\b(\d{1,78})\b/);
      return generic ? generic[1] : null;
    }

    function callContractFunctionFromPage(callable, inputValues, callOptions = {}) {
      return new Promise(resolve => {
        const requestId = `chat-tool-${Date.now()}-${callable.selector.slice(2)}-${Math.random().toString(16).slice(2)}`;
        const timeout = window.setTimeout(() => {
          chatToolReadRequests.delete(requestId);
          resolve({
            success: false,
            selector: callable.selector,
            signature: callable.signature,
            callMode: callable.callMode,
            simulated: callable.callMode === 'simulate',
            error: 'Contract call timed out'
          });
        }, 10000);

        chatToolReadRequests.set(requestId, payload => {
          window.clearTimeout(timeout);
          resolve({
            success: !!payload.success,
            selector: callable.selector,
            signature: callable.signature,
            callMode: payload.callMode || callable.callMode,
            simulated: payload.simulated ?? callable.callMode === 'simulate',
            result: payload.success ? String(payload.result ?? '') : null,
            rawChunks: payload.rawChunks || null,
            callOptionsUsed: payload.callOptionsUsed || {},
            error: payload.success ? null : String(payload.error || 'Contract call failed')
          });
        });

        window.postMessage({
          type: CALL_CONTRACT_FUNCTION_TYPE,
          purpose: CHAT_TOOL_READ_PURPOSE,
          requestId,
          selector: callable.selector,
          signature: callable.signature,
          contractAddress,
          inputTypes: callable.inputTypes || [],
          inputValues,
          callMode: callable.callMode,
          callOptions
        }, '*');
      });
    }

    function getMetadataAssetUri(metadata) {
      if (!metadata || typeof metadata !== 'object') return '';
      return String(metadata.image || metadata.image_url || metadata.animation_url || '').trim();
    }

    function compactTokenFetchResult(result) {
      if (!result?.ok) return result;
      const text = String(result.text || '');
      return {
        ok: true,
        uri: result.uri,
        fetchedUri: result.fetchedUri,
        contentType: result.contentType || '',
        json: result.json || null,
        textPreview: text.slice(0, 4000)
      };
    }

    function getTokenToolMetadata(toolContext) {
      if (!toolContext) return null;
      if (toolContext.kind === 'token_uri_fetch') return toolContext;
      if (toolContext.kind === 'contract_function_calls') {
        return (toolContext.calls || []).map(call => call.tokenMetadata).find(Boolean) || null;
      }
      return null;
    }

    function getTokenPreviewImageSrc(toolContext) {
      const metadata = getTokenToolMetadata(toolContext);
      if (!metadata) return '';
      const asset = metadata.assetResource?.ok ? metadata.assetResource : null;
      const token = metadata.tokenResource?.ok ? metadata.tokenResource : null;

      if (asset) {
        const assetUri = String(metadata.assetUri || asset.uri || '').trim();
        const assetText = String(asset.textPreview || '');
        if (/^data:image\//i.test(assetUri)) return assetUri;
        if (/^https?:\/\//i.test(asset.fetchedUri || assetUri) && /^image\//i.test(asset.contentType || '')) {
          return asset.fetchedUri || assetUri;
        }
        if (/svg/i.test(asset.contentType || '') || /^<svg[\s>]/i.test(assetText.trim())) {
          return svgToDataImage(assetText);
        }
      }

      if (token) {
        const tokenText = String(token.textPreview || '');
        const tokenUri = String(metadata.tokenUri || token.uri || '').trim();
        if (/^data:image\//i.test(tokenUri)) return tokenUri;
        if (/svg/i.test(token.contentType || '') || /^<svg[\s>]/i.test(tokenText.trim())) {
          return svgToDataImage(tokenText);
        }
      }

      return '';
    }

    function renderTokenToolPreview(toolContext) {
      const src = getTokenPreviewImageSrc(toolContext);
      if (!src) return '';
      const metadata = getTokenToolMetadata(toolContext);
      const tokenId = escapeHtml(metadata?.tokenId || '');
      return `<div class="evmole-chat-token-preview">
        <div class="evmole-chat-token-preview-label">Token ${tokenId} preview</div>
        <img src="${escapeHtml(src)}" alt="Token ${tokenId} preview" loading="lazy">
      </div>`;
    }

    async function fetchTokenMetadataForCall(callable, callResult, inputValues) {
      const name = String(callable.name || '').toLowerCase();
      if (!(name === 'tokenuri' || name === 'nfttokenuri' || name.endsWith('tokenuri'))) return null;
      if (!callResult?.success) return null;

      const tokenUri = String(callResult.result || '').trim();
      if (!tokenUri) return null;
      const tokenResource = await chromeMessage({
        type: FETCH_TOKEN_URI_TYPE,
        uri: tokenUri
      });

      let assetResource = null;
      const assetUri = getMetadataAssetUri(tokenResource?.json);
      if (assetUri) {
        assetResource = await chromeMessage({
          type: FETCH_TOKEN_URI_TYPE,
          uri: assetUri
        });
      }

      return {
        kind: 'token_uri_fetch',
        tokenId: String(inputValues?.[0] ?? ''),
        function: callable.signature,
        tokenUri,
        tokenResource: compactTokenFetchResult(tokenResource),
        assetUri,
        assetResource: compactTokenFetchResult(assetResource)
      };
    }

    async function buildChatToolContext(question) {
      const plannedCalls = planChatFunctionCalls(question);
      if (plannedCalls.length === 0) return null;

      const missingPlan = plannedCalls.find(plan => plan.missing?.length);
      if (missingPlan) {
        return {
          kind: 'missing_args',
          message: `Which value should I use for ${missingPlan.callable.signature}: ${missingPlan.missing.join(', ')}?`
        };
      }

      const calls = [];
      for (const plan of plannedCalls) {
        const result = await callContractFunctionFromPage(plan.callable, plan.args, plan.callOptions);
        const tokenMetadata = await fetchTokenMetadataForCall(plan.callable, result, plan.args).catch(() => null);
        calls.push({
          function: plan.callable.signature,
          selector: plan.callable.selector,
          name: plan.callable.name,
          mutability: plan.callable.mutability,
          callMode: result.callMode || plan.callable.callMode,
          simulated: !!result.simulated,
          args: plan.args,
          argTypes: plan.callable.inputTypes,
          callOptions: result.callOptionsUsed || plan.callOptions || {},
          success: !!result.success,
          result: result.success ? result.result : null,
          error: result.success ? null : result.error,
          rawChunks: result.rawChunks || undefined,
          tokenMetadata: tokenMetadata || undefined
        });
      }

      return {
        kind: 'contract_function_calls',
        note: 'These are local non-persistent eth_call results. callMode "simulate" means no transaction was signed and no state was changed.',
        calls
      };
    }

    async function submitChatQuestion(question) {
      const trimmed = String(question || '').trim();
      if (!trimmed) return;

      appendChatMessage('user', trimmed);
      chatHistory.push({ role: 'user', content: trimmed });

      const loadingItem = appendChatMessage('assistant', 'Thinking...', { loading: true });
      try {
        const context = await buildChatContext();
        const toolContext = await buildChatToolContext(trimmed);
        if (toolContext?.kind === 'missing_args') {
          loadingItem.classList.remove('loading');
          loadingItem.innerHTML = renderChatText(toolContext.message);
          chatHistory.push({ role: 'assistant', content: toolContext.message });
          return;
        }
        if (toolContext) {
          context.toolContext = toolContext;
        }
        const mentionedAddressKeys = extractMentionedAddressKeys(trimmed)
          .filter(address => normalizeAddressKey(address) !== normalizeAddressKey(contractAddress))
          .slice(0, MENTIONED_CONTRACTS_CHAT_LIMIT);
        if (mentionedAddressKeys.length > 0) {
          loadingItem.innerHTML = renderChatText('Fetching mentioned contract context...');
          const mentionedContracts = await Promise.all(
            mentionedAddressKeys.map(address => buildMentionedContractContext(address, context.contractCreator || getContractCreatorInfo()))
          );
          context.mentionedContracts = {
            selected: mentionedContracts,
            note: 'These contracts were explicitly mentioned in the chat input with @address or @(address). Compare them to the current contract even when deployer evidence says they are not from the same creator.'
          };
        }
        const relatedContracts = relatedContractsForCreator.length
          ? relatedContractsForCreator
          : await getRelatedContractsForCurrentCreator().catch(() => []);
        const mentionedRelatedContracts = extractMentionedRelatedContracts(trimmed, relatedContracts);
        const includeRelatedContracts = mentionedRelatedContracts.length > 0 || isCrossContractQuestion(trimmed);
        if (includeRelatedContracts && relatedContracts.length > 0) {
          context.relatedContracts = {
            creator: context.contractCreator || getContractCreatorInfo(),
            selected: mentionedRelatedContracts.length
              ? mentionedRelatedContracts
              : relatedContracts.slice(0, RELATED_CONTRACTS_CHAT_LIMIT),
            available: relatedContracts.slice(0, RELATED_CONTRACTS_CHAT_LIMIT),
            note: 'Related contracts are previously seen contracts from the same contract creator/deployer. Use them to explain integration patterns only when evidence supports it.'
          };
        }
        const selectedProvider = getSummaryProvider();
        let providerUsed = selectedProvider;
        let response;
        if (selectedProvider === 'codex') {
          loadingItem.innerHTML = renderChatText('Asking Codex...');
          response = await chromeMessage({
            type: CODEX_CHAT_TYPE,
            question: trimmed,
            context,
            history: chatHistory.slice(0, -1),
            fastMode: !!settings.codexFastMode,
            reasoningEffort: 'low'
          });
        } else {
          loadingItem.innerHTML = renderChatText('Asking OpenRouter...');
          response = await chromeMessage({
            type: OPENROUTER_CHAT_TYPE,
            question: trimmed,
            context,
            history: chatHistory.slice(0, -1)
          });
        }

        if (!response?.ok) {
          throw new Error(response?.error || `${providerUsed === 'codex' ? 'Codex' : 'OpenRouter'} chat failed.`);
        }

        loadingItem.classList.remove('loading');
        loadingItem.innerHTML = `${renderTokenToolPreview(toolContext)}${renderChatText(response.answer)}`;
        chatHistory.push({ role: 'assistant', content: response.answer });
      } catch (error) {
        loadingItem.classList.remove('loading');
        loadingItem.classList.add('error');
        loadingItem.innerHTML = renderChatText(error?.message || String(error));
      }
    }

    chatPanel.querySelector('.evmole-chat-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = chatPanel.querySelector('.evmole-chat-input');
      const question = input.value;
      input.value = '';
      hideMentionMenu();
      submitChatQuestion(question);
    });

    const chatInput = chatPanel.querySelector('.evmole-chat-input');
    const mentionMenu = chatPanel.querySelector('.evmole-chat-mention-menu');
    chatInput?.addEventListener('input', () => {
      activeMentionSelection = 0;
      refreshMentionMenu();
    });
    chatInput?.addEventListener('click', () => {
      refreshMentionMenu();
    });
    chatInput?.addEventListener('keydown', event => {
      const menuOpen = mentionMenu?.classList.contains('open');
      if (!menuOpen) return;

      const matches = getMentionMenuMatches();
      if (matches.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeMentionSelection = (activeMentionSelection + 1) % matches.length;
        updateMentionMenuSelection(mentionMenu);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeMentionSelection = (activeMentionSelection - 1 + matches.length) % matches.length;
        updateMentionMenuSelection(mentionMenu);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const selected = matches[activeMentionSelection] || matches[0];
        if (selected?.allRelated) {
          insertAllMentions();
        } else {
          insertMention(selected);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideMentionMenu();
      }
    });
    mentionMenu?.addEventListener('mousedown', event => {
      event.preventDefault();
      const item = event.target.closest('.evmole-chat-mention-item');
      if (!item) return;
      if (item.dataset.mentionAction === 'all') {
        insertAllMentions();
        return;
      }
      const address = item.dataset.contractAddress || '';
      const record = relatedContractsForCreator.find(entry => normalizeAddressKey(entry.contractAddress) === normalizeAddressKey(address));
      if (record) insertMention(record);
    });
    document.addEventListener('click', event => {
      if (!chatPanel.contains(event.target)) hideMentionMenu();
    });

    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        const target = event.target;
        const isEditable = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
        if (!isEditable || chatPanel.contains(target)) {
          event.preventDefault();
          setChatOpen(!chatPanel.classList.contains('open'));
        }
      }
    });

    attachSummaryControls();

    function compactSelectorNameBytecode(bytecode) {
      const value = String(bytecode || '');
      if (!value || value.length <= SELECTOR_NAME_BYTECODE_CHAR_LIMIT) {
        return {
          bytecode: value,
          truncated: false,
          originalChars: value.length
        };
      }
      const keep = Math.floor((SELECTOR_NAME_BYTECODE_CHAR_LIMIT - 80) / 2);
      return {
        bytecodeHead: value.slice(0, keep),
        bytecodeTail: value.slice(-keep),
        truncated: true,
        originalChars: value.length
      };
    }

    function selectorNameBaseName(signature) {
      return String(signature || '').split('(')[0].trim();
    }

    function isMeaningfulKnownFunctionName(name) {
      const value = String(name || '').trim();
      if (!value || value === 'Unknown') return false;
      const lower = value.toLowerCase();
      const genericNames = new Set([
        'name', 'symbol', 'decimals', 'totalsupply', 'balanceof', 'allowance',
        'approve', 'transfer', 'transferfrom', 'owner', 'renounceownership',
        'transferownership', 'supportsinterface'
      ]);
      if (genericNames.has(lower)) return false;
      return /[a-z]/i.test(value) && value.length >= 4;
    }

    function isSelectorNameNoArgRead(record) {
      if (!record?.isRead) return false;
      const inputTypes = Array.isArray(record.inputTypes) ? record.inputTypes.filter(Boolean) : [];
      return (record.args || '()') === '()' && inputTypes.length === 0;
    }

    function profileSelectorNameRequest(selectorRecords, targetRecords, eventData, options = {}) {
      const includeNamedUnknowns = !!options.includeNamedUnknowns;
      const allRecords = Array.isArray(selectorRecords) ? selectorRecords : [];
      const recordsToName = Array.isArray(targetRecords) ? targetRecords : allRecords.filter(record => record?.isUnknown && !record.heuristicName);
      const unknownCount = recordsToName.filter(record => record?.isUnknown && (includeNamedUnknowns || !record.heuristicName)).length;
      const knownRecords = allRecords.filter(record => !record?.isUnknown);
      const knownNames = [...new Set(knownRecords.map(record => selectorNameBaseName(record.signature)).filter(Boolean))];
      const meaningfulKnownNames = knownNames.filter(isMeaningfulKnownFunctionName);
      const knownCount = knownRecords.length;
      const allUnknownCount = allRecords.filter(record => record?.isUnknown).length;
      const denominator = knownCount + allUnknownCount;
      const knownCoverage = denominator > 0 ? knownCount / denominator : 0;
      const unknownNoArgReadCount = recordsToName.filter(isSelectorNameNoArgRead).length;
      const bytecodeSize = String(eventData?.analyzedBytecode || '').length;
      const vocabularyStrength = meaningfulKnownNames.length >= 6 ? 'strong' : (meaningfulKnownNames.length >= 3 ? 'moderate' : 'weak');

      return {
        unknownCount,
        knownCount,
        knownCoverage: Number(knownCoverage.toFixed(3)),
        unknownNoArgReadCount,
        bytecodeSize,
        vocabularyStrength,
        meaningfulKnownNameCount: meaningfulKnownNames.length
      };
    }

    function chooseSelectorNameContextMode(profile, { retry = false } = {}) {
      if (retry) return 'rich';
      if (!profile || profile.unknownCount <= 0) return 'compact';
      const strongKnownContext = profile.knownCoverage >= 0.7 && profile.vocabularyStrength !== 'weak';
      if (profile.unknownCount <= 4 && strongKnownContext) return 'compact';
      if (profile.unknownCount > 12 || profile.knownCoverage < 0.5 || profile.vocabularyStrength === 'weak') return 'balanced';
      return 'compact';
    }

    function selectorNameBatchSizeForMode(contextMode) {
      return contextMode === 'rich' ? SELECTOR_NAME_RICH_BATCH_SIZE : SELECTOR_NAME_BATCH_SIZE;
    }

    function shouldIncludeSelectorNameBytecode(contextMode) {
      return contextMode === 'balanced' || contextMode === 'rich';
    }

    function compactSelectorNameReadEvidence(result) {
      if (!result) return null;
      return {
        selector: normalizeSelectorId(result.selector),
        signature: String(result.signature || result.name || '').slice(0, 120),
        success: !!result.success,
        value: result.success ? String(result.value ?? '').slice(0, 500) : null,
        error: result.success ? null : String(result.error || 'Read query failed').slice(0, 160)
      };
    }

    function buildSelectorNameContext(selectorRecords, eventData, cacheParams, targetRecords = null, options = {}) {
      const contextMode = options.contextMode || 'balanced';
      const includeNamedUnknowns = !!options.includeNamedUnknowns;
      const recordsToName = Array.isArray(targetRecords) ? targetRecords : selectorRecords;
      const unknownSelectors = (recordsToName || [])
        .filter(record => record?.isUnknown && (includeNamedUnknowns || !record.heuristicName))
        .map(record => ({
          selector: normalizeSelectorId(record.selector),
          args: record.args || '',
          mutability: record.mutability || '',
          inputTypes: record.inputTypes || [],
          isRead: !!record.isRead
        }))
        .slice(0, selectorNameBatchSizeForMode(contextMode));

      const knownFunctions = (selectorRecords || [])
        .filter(record => !record?.isUnknown)
        .map(record => ({
          selector: normalizeSelectorId(record.selector),
          signature: record.signature,
          args: record.args || '',
          mutability: record.mutability || '',
          isRead: !!record.isRead
        }))
        .slice(0, 80);
      const knownFunctionTable = knownFunctions
        .map(record => `${record.selector} ${record.args || '()'} ${record.mutability || ''} ${record.signature}`)
        .join('\n');
      const knownFunctionNames = [...new Set(knownFunctions
        .map(record => String(record.signature || '').split('(')[0])
        .filter(Boolean))]
        .slice(0, 80);

      const context = {
        promptVersion: SELECTOR_NAME_PROMPT_VERSION,
        contextMode,
        chainHost: window.location.hostname,
        pageUrl: window.location.href,
        contractAddress,
        implementationAddress: eventData.implementationAddress || null,
        implementationPath: Array.isArray(eventData.implementationPath) ? eventData.implementationPath : [],
        bytecodeSource: eventData.bytecodeSource || null,
        bytecodeHash: cacheParams.bytecodeHash,
        bytecodeIncluded: shouldIncludeSelectorNameBytecode(contextMode),
        unknownSelectors,
        unknownSelectorTable: unknownSelectors
          .map(record => `${record.selector} ${record.args || '()'} ${record.mutability || ''} Unknown`)
          .join('\n'),
        knownFunctions,
        knownFunctionNames,
        knownFunctionTable,
        selectorNameProfile: options.profile || profileSelectorNameRequest(selectorRecords, targetRecords, eventData, { includeNamedUnknowns }),
        note: 'Heuristic names are provisional UI labels for selectors whose real ABI signature is unknown.'
      };
      if (shouldIncludeSelectorNameBytecode(contextMode)) {
        context.bytecode = compactSelectorNameBytecode(eventData.analyzedBytecode);
      }
      const readEvidence = Array.isArray(options.readEvidence)
        ? options.readEvidence.map(compactSelectorNameReadEvidence).filter(Boolean)
        : [];
      if (readEvidence.length > 0) {
        context.readEvidence = readEvidence;
      }
      return context;
    }

    function applyAiSelectorNames(selectorRecords, names) {
      const normalized = new Map((names || [])
        .map(normalizeAiSelectorNameEntry)
        .filter(Boolean)
        .map(entry => [entry.selector, entry]));
      if (normalized.size === 0) return [];

      const applied = [];
      (selectorRecords || []).forEach(record => {
        if (!record?.isUnknown) return;
        const entry = normalized.get(normalizeSelectorId(record.selector));
        if (!entry) return;
        record.heuristicName = entry.heuristicName;
        record.heuristicSource = entry.source;
        record.heuristicConfidence = entry.confidence;
        record.heuristicReasoning = entry.reasoning;
        applied.push(entry);

        const item = panel.querySelector(`.selector-item[data-selector="${CSS.escape(normalizeSelectorId(record.selector))}"]`);
        if (!item) return;
        const displayName = `${entry.heuristicName}${record.args || '()'}`;
	        item.classList.remove('highlight-ai-pending');
	        item.classList.add('highlight-ai-heuristic');
	        item.dataset.heuristicName = entry.heuristicName;
	        item.dataset.heuristicConfidence = entry.confidence;
	        item.dataset.heuristicSource = entry.source;
	        item.dataset.querySignature = displayName;
	        const functionNameEl = item.querySelector('.function-name');
        if (functionNameEl) {
          functionNameEl.dataset.full = displayName;
          functionNameEl.textContent = panel.parentNode?.querySelector('.evmole-panel.collapsed')
            ? `${entry.heuristicName}()`
            : displayName;
        }
        const functionInfo = item.querySelector('.function-info');
        functionInfo?.querySelectorAll('.ai-heuristic-indicator').forEach(badge => badge.remove());
        if (functionInfo) {
          const badge = document.createElement('span');
          badge.className = 'ai-heuristic-indicator';
          badge.textContent = 'AI';
          badge.title = entry.reasoning
            ? `AI heuristic (${entry.confidence} confidence): ${entry.reasoning}`
            : `AI heuristic (${entry.confidence} confidence)`;
          functionInfo.appendChild(badge);
        }
	      });
	
	      if (applied.length > 0) {
	        latestCallableFunctionRegistry = buildCallableFunctionRegistry(selectorRecords, latestSummaryContextBase?.verifiedAbi || []);
	      }

	      return applied;
	    }

    function clearAiPendingState(selectorRecords) {
      (selectorRecords || []).forEach(record => {
        if (!record?.isUnknown || record.heuristicName) return;
        const item = panel.querySelector(`.selector-item[data-selector="${CSS.escape(normalizeSelectorId(record.selector))}"]`);
        item?.classList.remove('highlight-ai-pending');
        item?.querySelector('.ai-heuristic-indicator.pending')?.remove();
      });
    }

    function requestSelectorNameRead(record, index) {
      return new Promise(resolve => {
        const selector = normalizeSelectorId(record.selector);
        const requestId = `selector-name-${Date.now()}-${index}-${selector.slice(2)}`;
        const displayName = record.heuristicName || 'unknown';
        const signature = `${displayName}${record.args || '()'}`;
        const timeout = window.setTimeout(() => {
          summaryReadRequests.delete(requestId);
          resolve({
            selector,
            signature,
            success: false,
            error: 'Read query timed out'
          });
        }, SELECTOR_NAME_READ_TIMEOUT_MS);

        summaryReadRequests.set(requestId, payload => {
          window.clearTimeout(timeout);
          resolve({
            selector,
            signature,
            success: !!payload.success,
            value: payload.success ? String(payload.result ?? '') : null,
            error: payload.success ? null : String(payload.error || 'Read query failed')
          });
        });

        window.setTimeout(() => {
          if (!panel.isConnected) {
            summaryReadRequests.delete(requestId);
            window.clearTimeout(timeout);
            resolve({
              selector,
              signature,
              success: false,
              error: 'Panel closed'
            });
            return;
          }

          window.postMessage({
            type: 'QUERY_READ_FUNCTION',
            purpose: SELECTOR_NAME_READ_PURPOSE,
            requestId,
            selector,
            signature,
            contractAddress,
            inputTypes: [],
            inputValues: []
          }, '*');
        }, index * SELECTOR_NAME_READ_STAGGER_MS);
      });
    }

    async function requestSelectorNameReadEvidence(records) {
      const candidates = (records || [])
        .filter(record => record?.isUnknown && isSelectorNameNoArgRead(record))
        .slice(0, SELECTOR_NAME_READ_EVIDENCE_LIMIT);
      if (candidates.length === 0) return [];
      const results = await Promise.all(candidates.map((record, index) => requestSelectorNameRead(record, index)));
      return results.map(compactSelectorNameReadEvidence).filter(Boolean);
    }

    function selectSelectorNameRetryRecords(batchRecords, applied) {
      const appliedBySelector = new Map((applied || [])
        .map(entry => [normalizeSelectorId(entry.selector), entry]));
      return (batchRecords || []).filter(record => {
        const selector = normalizeSelectorId(record.selector);
        const entry = appliedBySelector.get(selector);
        if (!entry) return true;
        return entry.source === 'fallback' || entry.confidence === 'low';
      });
    }

    async function requestAiSelectorNames(selectorRecords, eventData, cacheParams) {
      const unknownRecords = (selectorRecords || []).filter(record => record?.isUnknown && !record.heuristicName);
      if (unknownRecords.length === 0 || !cacheParams?.bytecodeHash || !eventData?.analyzedBytecode) return;
      if (!await hasCodexLogin()) {
        clearAiPendingState(selectorRecords);
        return;
      }

      const initialProfile = profileSelectorNameRequest(selectorRecords, unknownRecords, eventData);
      const initialContextMode = chooseSelectorNameContextMode(initialProfile);
      const initialBatchSize = selectorNameBatchSizeForMode(initialContextMode);

      for (let index = 0; index < unknownRecords.length; index += initialBatchSize) {
        const batchRecords = unknownRecords.slice(index, index + initialBatchSize)
          .filter(record => record?.isUnknown && !record.heuristicName);
        if (batchRecords.length === 0) continue;

        const batchSelectors = batchRecords
          .map(record => normalizeSelectorId(record.selector))
          .filter(Boolean);
        const batchProfile = profileSelectorNameRequest(selectorRecords, batchRecords, eventData);
        const contextMode = chooseSelectorNameContextMode(batchProfile);
        const batchCacheParams = {
          ...cacheParams,
          selectors: batchSelectors
        };
        const response = await chromeMessage({
          type: CODEX_SELECTOR_NAMES_TYPE,
          context: buildSelectorNameContext(selectorRecords, eventData, batchCacheParams, batchRecords, {
            contextMode,
            profile: batchProfile
          }),
          fastMode: !!settings.codexFastMode,
          reasoningEffort: 'low',
          dedupeKey: stableStringify({ ...batchCacheParams, contextMode })
        });
        if (!response?.ok) {
          console.log('Codex selector naming failed:', response?.error || response, { selectors: batchSelectors });
          clearAiPendingState(batchRecords);
          continue;
        }

        const applied = applyAiSelectorNames(selectorRecords, response.names || []);
        if (applied.length > 0) {
          const cacheable = applied.filter(entry => entry.source !== 'fallback');
          await storeAiSelectorNameCache(settings, {
            ...batchCacheParams,
            model: response.model || batchCacheParams.model,
            promptVersion: response.promptVersion || batchCacheParams.promptVersion
          }, cacheable);
        }

        const retryRecords = contextMode === 'rich'
          ? []
          : selectSelectorNameRetryRecords(batchRecords, applied).slice(0, SELECTOR_NAME_RICH_BATCH_SIZE);
        if (retryRecords.length > 0) {
          const retrySelectors = retryRecords.map(record => normalizeSelectorId(record.selector)).filter(Boolean);
          const readEvidence = await requestSelectorNameReadEvidence(retryRecords);
          const retryCacheParams = {
            ...batchCacheParams,
            selectors: retrySelectors
          };
          const retryProfile = profileSelectorNameRequest(selectorRecords, retryRecords, eventData, { includeNamedUnknowns: true });
          const retryResponse = await chromeMessage({
            type: CODEX_SELECTOR_NAMES_TYPE,
            context: buildSelectorNameContext(selectorRecords, eventData, retryCacheParams, retryRecords, {
              contextMode: chooseSelectorNameContextMode(retryProfile, { retry: true }),
              includeNamedUnknowns: true,
              profile: retryProfile,
              readEvidence
            }),
            fastMode: !!settings.codexFastMode,
            reasoningEffort: 'low',
            dedupeKey: stableStringify({
              ...retryCacheParams,
              contextMode: 'rich',
              readEvidenceSelectors: readEvidence.map(entry => entry.selector)
            })
          });
          if (retryResponse?.ok) {
            const retryApplied = applyAiSelectorNames(selectorRecords, retryResponse.names || []);
            if (retryApplied.length > 0) {
              const cacheable = retryApplied.filter(entry => entry.source !== 'fallback');
              await storeAiSelectorNameCache(settings, {
                ...retryCacheParams,
                model: retryResponse.model || retryCacheParams.model,
                promptVersion: retryResponse.promptVersion || retryCacheParams.promptVersion
              }, cacheable);
            }
          } else {
            console.log('Codex selector naming rich retry failed:', retryResponse?.error || retryResponse, { selectors: retrySelectors });
          }
        }

        const appliedSelectors = new Set(applied.map(entry => normalizeSelectorId(entry.selector)));
        const unresolvedSelectors = batchSelectors.filter(selector => !appliedSelectors.has(selector));
        if (unresolvedSelectors.length > 0) {
          console.log('Codex selector naming returned no accepted heuristic for some selectors:', unresolvedSelectors);
        }
        clearAiPendingState(batchRecords);
      }
    }

    const messageHandler = async function(event) {
      if (event.data && event.data.type === 'FUNCTION_SELECTORS_RESULT') {
        if (event.data.selectors && Array.isArray(event.data.selectors) && event.data.selectors.length > 0) {
          const readFunctions = [];
          const writeFunctions = [];
          const selectorRecords = [];
          const verifiedAbi = getVerifiedContractAbi();
          const verifiedFunctions = Array.isArray(verifiedAbi)
            ? verifiedAbi.filter(entry => entry?.type === 'function').slice(0, 200)
            : [];
          const verifiedFunctionMaps = buildVerifiedFunctionMaps(verifiedFunctions);
          const verifiedFunctionRecords = [...verifiedFunctionMaps.bySignature.values()];
          const parsedSelectors = event.data.selectors.map(parseSelectorDetail).filter(Boolean);
          const aiCacheParams = {
            chainHost: window.location.hostname,
            contractAddress,
            implementationAddress: event.data.implementationAddress || '',
            bytecodeHash: String(event.data.analyzedBytecodeHash || '').trim().toLowerCase(),
            model: getSelectorNameCacheModel(settings),
            promptVersion: SELECTOR_NAME_PROMPT_VERSION,
            selectors: parsedSelectors.filter(record => record.isUnknown).map(record => normalizeSelectorId(record.selector))
          };
          const cachedAiNames = verifiedFunctions.length === 0 && aiCacheParams.selectors.length > 0
            ? await fetchAiSelectorNameCache(settings, aiCacheParams)
            : new Map();

          const findVerifiedFunctionForUnknown = (rawParamTypes, mutability) => {
            const normalizedRawTypes = rawParamTypes.map(normalizeAbiType);
            const matches = verifiedFunctionRecords.filter(record => {
              const verifiedTypes = (record.inputTypes || []).map(normalizeAbiType);
              if (verifiedTypes.length !== normalizedRawTypes.length) return false;
              if (!verifiedTypes.every((type, index) => type === normalizedRawTypes[index])) return false;
              const verifiedMutability = String(record.stateMutability || '').toLowerCase();
              return !verifiedMutability || !mutability || verifiedMutability === String(mutability).toLowerCase();
            });
            return matches.length === 1 ? matches[0] : null;
          };

          const compareFunctionDisplayItems = (a, b) => {
            const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            if (byName !== 0) return byName;
            const byArgs = a.args.localeCompare(b.args, undefined, { sensitivity: 'base' });
            if (byArgs !== 0) return byArgs;
            return a.selector.localeCompare(b.selector, undefined, { sensitivity: 'base' });
          };

          parsedSelectors.forEach(parsedSelector => {
            const selectorId = normalizeSelectorId(parsedSelector.selector);
            const { args, mutability } = parsedSelector;
            let functionName = parsedSelector.signature;
            const rawParamTypes = splitTopLevelAbiTypes(args);
            let verifiedFunction = verifiedFunctionMaps.bySignature.get(functionName)
              || verifiedFunctionMaps.byNameAndInputs.get(`${functionName.split('(')[0].toLowerCase()}(${rawParamTypes.join(',')})`);
            if ((!functionName || functionName === 'Unknown') && verifiedFunctions.length > 0) {
              verifiedFunction = findVerifiedFunctionForUnknown(rawParamTypes, mutability);
              if (verifiedFunction?.signature) functionName = verifiedFunction.signature;
            }
            const effectiveMutability = verifiedFunction?.stateMutability || mutability;
            const isRealUnknown = functionName === 'Unknown';
            const aiName = isRealUnknown ? cachedAiNames.get(selectorId) : null;
            const displayName = aiName ? `${aiName.heuristicName}${args || '()'}` : functionName;
            const aiBadge = aiName
              ? `<span class="ai-heuristic-indicator" title="${escapeHtml(aiName.reasoning ? `AI heuristic (${aiName.confidence} confidence): ${aiName.reasoning}` : `AI heuristic (${aiName.confidence} confidence)`)}">AI</span>`
              : (isRealUnknown && verifiedFunctions.length === 0 && aiCacheParams.bytecodeHash && event.data.analyzedBytecode
                ? '<span class="ai-heuristic-indicator pending" title="Waiting for Codex heuristic naming">AI pending</span>'
                : '');

            const isNonStandard = !standardFunctionSignatures.includes(functionName) &&
                                  !standardFunctionSelectors.has(selectorId.toLowerCase());
            const highlightClass = [
              isNonStandard ? 'highlight-non-standard' : '',
              aiName ? 'highlight-ai-heuristic' : '',
              (!aiName && isRealUnknown && verifiedFunctions.length === 0 && aiCacheParams.bytecodeHash && event.data.analyzedBytecode) ? 'highlight-ai-pending' : ''
            ].filter(Boolean).join(' ');

            const isReadFunction = effectiveMutability === 'view' || effectiveMutability === 'pure';
            const normalizedParamTypes = (verifiedFunction?.inputTypes?.length ? verifiedFunction.inputTypes : rawParamTypes).map(normalizeAbiType);
            const hasParseableParams = normalizedParamTypes.length > 0 && normalizedParamTypes.every(Boolean);
	            const canQueryUnknownRead = isRealUnknown && isReadFunction && (aiName || aiCacheParams.bytecodeHash || normalizedParamTypes.length > 0);
	            const isNoArgRead = isReadFunction && args === '()' && (!isRealUnknown || canQueryUnknownRead);
	            const isParameterizedRead = isReadFunction && hasParseableParams && (!isRealUnknown || canQueryUnknownRead);
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
                   data-query-signature="${escapeHtml(aiName ? displayName : functionName)}"
	                   data-heuristic-name="${escapeHtml(aiName?.heuristicName || '')}"
                   data-heuristic-source="${escapeHtml(aiName?.source || '')}"
                   data-heuristic-confidence="${escapeHtml(aiName?.confidence || '')}"
                   data-queryable="${isNoArgRead || isParameterizedRead}"
                   data-param-types="${escapeHtml(JSON.stringify(normalizedParamTypes.filter(Boolean)))}">
                <div class="selector-info">
                  <span class="selector-id">${selectorId}</span>
                  <span class="arguments">${args}</span>
                  <span class="mutability">${effectiveMutability}</span>
                </div>
                <div class="function-info">
                  <span class="function-name">${escapeHtml(displayName)}</span>${aiBadge}${queryIndicator}
                </div>
                ${queryDropdown}
              </div>
            `;

            selectorRecords.push({
              selector: selectorId,
              args,
              mutability: effectiveMutability,
              signature: functionName,
              inputTypes: normalizedParamTypes.filter(Boolean),
              inputNames: verifiedFunction?.inputNames || [],
              isRead: isReadFunction,
              isUnknown: isRealUnknown,
              heuristicName: aiName?.heuristicName || '',
              heuristicSource: aiName?.source || '',
              heuristicConfidence: aiName?.confidence || '',
              heuristicReasoning: aiName?.reasoning || ''
            });

            if (isReadFunction) {
              readFunctions.push({
                name: displayName,
                args,
                selector: selectorId,
                html: itemHtml
              });
            } else {
              writeFunctions.push({
                name: displayName,
                args,
                selector: selectorId,
                html: itemHtml
              });
            }
          });

          let selectorsHtml = '';
          selectorsHtml += renderContractBadgeList(selectorRecords, 'selector-identifier-strip');

          // Show implementation address if proxy detected
          if (event.data.implementationAddress) {
            const implementationPath = Array.isArray(event.data.implementationPath)
              ? event.data.implementationPath.filter(addr => /^0x[a-fA-F0-9]{40}$/.test(addr)).slice(0, 4)
              : [];
            const addresses = implementationPath.length > 0
              ? implementationPath
              : [event.data.implementationAddress].filter(addr => /^0x[a-fA-F0-9]{40}$/.test(addr));
            if (addresses.length > 0) {
              const label = addresses.length > 1 ? 'Proxy chain' : 'Proxy';
              const links = addresses.map(addr => {
                const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
                return `<a href="/address/${escapeHtml(addr)}" target="_blank" class="impl-link">${escapeHtml(shortAddr)}</a>`;
              }).join('<span> &rarr; </span>');
              selectorsHtml += `<div class="impl-notice">
                <span>${label} &rarr; </span>
                ${links}
              </div>`;
            }
          }

          if (readFunctions.length > 0) {
            selectorsHtml += `<div class="section-header">Read Functions</div>`;
            selectorsHtml += readFunctions.sort(compareFunctionDisplayItems).map(item => item.html).join('');
          }
          if (writeFunctions.length > 0) {
            if (readFunctions.length > 0) {
              selectorsHtml += `<div class="section-divider"></div>`;
            }
            selectorsHtml += `<div class="section-header write-section">Write Functions</div>`;
            selectorsHtml += writeFunctions.sort(compareFunctionDisplayItems).map(item => item.html).join('');
          }

          if (panel && panel.parentNode) {
            latestCallableFunctionRegistry = buildCallableFunctionRegistry(selectorRecords, verifiedFunctions);
            latestSummaryContextBase = {
              promptVersion: SUMMARY_PROMPT_VERSION,
              model: SUMMARY_MODEL,
              chainHost: window.location.hostname,
              pageUrl: window.location.href,
              contractAddress,
              contractCreator: getContractCreatorInfo(),
              implementationAddress: event.data.implementationAddress || null,
              implementationPath: Array.isArray(event.data.implementationPath) ? event.data.implementationPath : [],
              bytecodeSource: event.data.bytecodeSource || null,
              analyzedBytecodeHash: event.data.analyzedBytecodeHash || null,
              counts: {
                functions: selectorRecords.length,
                read: selectorRecords.filter(record => record.isRead).length,
                write: selectorRecords.filter(record => !record.isRead).length,
                unknown: selectorRecords.filter(record => record.isUnknown).length
              },
              functions: selectorRecords,
              verifiedAbi: verifiedFunctions,
              verifiedAbiHash: verifiedFunctions.length
                ? await sha256Hex(stableStringify(verifiedFunctions))
                : null
            };
            rememberCurrentRelatedContract();
            updateSummaryContractBadges(selectorRecords);

            renderPanelBody(`<div id="selectors">${selectorsHtml}</div>`);
            hydrateCachedSummary();

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
	                  const signature = item.dataset.querySignature || item.dataset.signature;
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
            if (verifiedFunctions.length === 0) {
              requestAiSelectorNames(selectorRecords, event.data, aiCacheParams).catch(e => {
                console.log('AI selector naming request error:', e?.message || e);
                clearAiPendingState(selectorRecords);
              });
            }
          }
        } else if (panel && panel.parentNode) {
          const errorMsg = event.data.error || 'No function selectors found';
          updateSummaryContractBadges([]);
          renderPanelBody(`<div id="selectors"><div class="error-notice">${escapeHtml(errorMsg)}</div></div>`);
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
        if (purpose === SUMMARY_READ_PURPOSE || purpose === SELECTOR_NAME_READ_PURPOSE) {
          const resolver = summaryReadRequests.get(event.data.requestId);
          if (resolver) {
            summaryReadRequests.delete(event.data.requestId);
            resolver(event.data);
          }
          return;
        }
        if (purpose === CHAT_TOOL_READ_PURPOSE) {
          const resolver = chatToolReadRequests.get(event.data.requestId);
          if (resolver) {
            chatToolReadRequests.delete(event.data.requestId);
            resolver(event.data);
          }
          return;
        }

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

      if (event.data && event.data.type === CALL_CONTRACT_FUNCTION_RESULT_TYPE) {
        if (event.data.success) {
          panel.addDiscoveredLinks?.(extractLinksFromResultValue(event.data.result));
          panel.addDiscoveredLinks?.(extractLinksFromResultValue(event.data.linkScanValue));
        }
        const resolver = chatToolReadRequests.get(event.data.requestId);
        if (resolver) {
          chatToolReadRequests.delete(event.data.requestId);
          resolver(event.data);
        }
        return;
      }

      if (event.data && event.data.type === 'ANALYZE_CONTRACT_ADDRESS_RESULT') {
        const resolver = contractMentionAnalysisRequests.get(event.data.requestId);
        if (resolver) {
          contractMentionAnalysisRequests.delete(event.data.requestId);
          resolver(event.data);
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
      contractMentionAnalysisRequests.clear();
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
