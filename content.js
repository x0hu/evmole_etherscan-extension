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
    signatureDatabaseStoreUnknowns: false
  };
  const OPENROUTER_SUMMARY_TYPE = 'EVMOLE_OPENROUTER_SUMMARY';
  const OPENROUTER_STATUS_TYPE = 'EVMOLE_OPENROUTER_STATUS';
  const OPENROUTER_CHAT_TYPE = 'EVMOLE_OPENROUTER_CHAT';
  const FETCH_TOKEN_URI_TYPE = 'EVMOLE_FETCH_TOKEN_URI';
  const SUMMARY_PROMPT_VERSION = 'evmole-contract-summary-v5-decimals-fallback';
  const SUMMARY_MODEL = 'deepseek/deepseek-v4-flash';
  const SUMMARY_READ_PURPOSE = 'SUMMARY_CONTEXT';
  const CHAT_TOOL_READ_PURPOSE = 'CHAT_TOOL_READ';
  const SUMMARY_MIN_AUTO_READ_LIMIT = 10;
  const SUMMARY_MAX_AUTO_READ_LIMIT = 20;
  const SUMMARY_RELOAD_READ_LIMIT = 35;
  const SUMMARY_AUTO_READ_TIMEOUT_MS = 3000;
  const SUMMARY_RELOAD_READ_TIMEOUT_MS = 8000;
  const SUMMARY_AUTO_READ_STAGGER_MS = 100;
  const SUMMARY_RELOAD_READ_STAGGER_MS = 180;
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
      <div class="evmole-chat-log" role="log" aria-live="polite">
        <div class="evmole-chat-empty">Ask about this contract.</div>
      </div>
      <form class="evmole-chat-form">
        <input class="evmole-chat-input" type="text" placeholder="Ask about this contract..." autocomplete="off" spellcheck="false">
        <button class="evmole-chat-send" type="submit">Ask</button>
      </form>
    `;
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
        resolve({ ok: false, error: 'Extension runtime is unavailable.' });
        return;
      }

      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || 'Extension message failed.' });
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

  async function storeContractSummaryCache(settings, body) {
    const baseUrl = getSignatureDatabaseBaseUrl(settings);
    if (!baseUrl) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      await fetch(`${baseUrl}/contract-summaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body)
      });
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
    const match = String(value || '').match(/0x[a-fA-F0-9]{40}/);
    return match ? match[0] : '';
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
    const values = Array.isArray(facts) ? facts.slice(0, 6).filter(fact => fact?.label || fact?.value) : [];
    if (values.length === 0) return '';
    return `<div class="summary-facts">${values.map(fact => `
      <div class="summary-fact">
        <div class="summary-fact-label">${escapeHtml(fact.label || 'Fact')}</div>
        <div class="summary-fact-value">${renderSummaryFactValue(fact.value || '')}</div>
        ${fact.source ? `<div class="summary-fact-source">${escapeHtml(fact.source)}</div>` : ''}
      </div>
    `).join('')}</div>`;
  }

  function formatElapsedTime(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function renderSummaryResult(summary) {
    const facts = Array.isArray(summary?.facts) ? summary.facts : [];
    const readContext = Array.isArray(summary?.read_context) ? summary.read_context.slice(0, 3) : [];
    const unknowns = Array.isArray(summary?.unknowns) ? summary.unknowns.slice(0, 3) : [];
    const keyBehaviors = Array.isArray(summary?.key_behaviors) ? summary.key_behaviors.slice(0, 3) : [];
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
      ${limits.length ? `<div class="summary-subhead">Limits/rules</div>${renderSummaryList(limits, 4)}` : ''}
      ${controls.length ? `<div class="summary-subhead">Controls</div>${renderSummaryList(controls)}` : ''}
      ${readContext.length ? `<div class="summary-subhead">Read context</div><ul>${readContext.map(entry => `<li><strong>${escapeHtml(entry.name || 'read')}</strong>: ${escapeHtml(entry.value || '')}${entry.meaning ? ` — ${escapeHtml(entry.meaning)}` : ''}</li>`).join('')}</ul>` : ''}
      ${unknowns.length ? `<div class="summary-subhead">Unknowns</div><ul>${unknowns.map(entry => `<li><strong>${escapeHtml(entry.selector || 'unknown')}</strong>: ${escapeHtml(entry.reason || '')}${entry.suggested_next_read ? ` Next: ${escapeHtml(entry.suggested_next_read)}` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function setSummaryState(summaryPanel, state, { message = '', summary = null } = {}) {
    const summaryEl = summaryPanel.querySelector('.evmole-summary');
    if (!summaryEl) return;

    summaryEl.dataset.state = state;
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
    const summaryReadRequests = new Map();
    const chatToolReadRequests = new Map();
    let latestSummaryContextBase = null;
    let latestSummaryResult = null;
    let autoSummaryHydrationKey = null;
    let summaryCacheMissKey = null;
    let autoSummaryAttempted = false;
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

    function detectContractProfiles(functions) {
      const names = new Set((functions || []).map(getFunctionName).filter(Boolean));
      const has = (...candidates) => candidates.some(name => names.has(name) || [...names].some(existing => existing.includes(name)));
      const profiles = [];

      if (has('decimals', 'totalsupply', 'maxsupply', 'totalminted', 'balanceof', 'symbol', 'name', 'transfer')) profiles.push('token');
      if (has('buytax', 'selltax', 'tax', 'fee', 'maxwallet', 'maxtx', 'tradingenabled', 'swapback', 'excludefromfees')) profiles.push('taxed_token');
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
        if (patterns.some(pattern => name.includes(pattern))) score += weight;
      };

      if (name === 'decimals') score += 240;
      if (name === 'symbol' || name === 'name') score += 85;
      addIf(130, 'totalsupply', 'totalminted', 'maxsupply', 'circulatingsupply');
      addIf(120, 'contributionamount', 'maxraise', 'maxcontributor', 'salestart', 'saleend', 'finalizeallowedat', 'readytofinalize');
      addIf(115, 'buytax', 'selltax', 'tax', 'fee', 'maxwallet', 'maxtx', 'maxtransaction', 'tradingenabled', 'cooldown');
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
      if (profileSet.has('token')) addIf(80, 'decimals', 'supply', 'minted', 'symbol', 'name');
      if (profileSet.has('taxed_token')) addIf(80, 'tax', 'fee', 'wallet', 'transaction', 'trading', 'swap', 'pair', 'router');
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
      const readQueryLimit = reloadContext ? SUMMARY_RELOAD_READ_LIMIT : getAutoReadLimitForProfiles(profiles);
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

      const context = {
        ...latestSummaryContextBase,
        sourceLinks: (panel.getAllDiscoveredLinks?.() || getContractSourceLinks()).slice(0, 30),
        contractInfo: getContractInfoText(),
        detectedProfiles: selection.profiles,
        readQueryMode: 'profile-scored high-signal no-arg view/pure reads only',
        readQueryLimit,
        readQuerySelected: readCandidates.length,
        readQueryTimeoutMs: readTimeoutMs,
        reloadContext: !!reloadContext,
        readResults
      };
      const contextHash = await sha256Hex(stableStringify({
        chainHost: context.chainHost,
        contractAddress: context.contractAddress,
        implementationAddress: context.implementationAddress || null,
        bytecodeSource: context.bytecodeSource || null,
        functions: context.functions,
        verifiedAbiHash: context.verifiedAbiHash || null,
        contractInfo: context.contractInfo,
        sourceLinks: context.sourceLinks
      }));

      return { context, contextHash };
    }

    async function buildChatContext() {
      if (!latestSummaryContextBase) {
        throw new Error('Function context is not ready yet.');
      }

      return {
        ...latestSummaryContextBase,
        sourceLinks: (panel.getAllDiscoveredLinks?.() || getContractSourceLinks()).slice(0, 20),
        contractInfo: getContractInfoText(),
        currentSummary: latestSummaryResult?.summary || null,
        note: 'Chat context includes parsed function surface and current summary. It does not auto-query additional parameterized reads.'
      };
    }

    async function buildSummaryCacheParams() {
      if (!latestSummaryContextBase) {
        throw new Error('Function context is not ready yet.');
      }

      const baseContext = {
        ...latestSummaryContextBase,
        sourceLinks: (panel.getAllDiscoveredLinks?.() || getContractSourceLinks()).slice(0, 30),
        contractInfo: getContractInfoText()
      };
      const hashPayload = {
        chainHost: baseContext.chainHost,
        contractAddress: baseContext.contractAddress,
        implementationAddress: baseContext.implementationAddress || null,
        bytecodeSource: baseContext.bytecodeSource || null,
        functions: baseContext.functions,
        verifiedAbiHash: baseContext.verifiedAbiHash || null,
        contractInfo: baseContext.contractInfo,
        sourceLinks: baseContext.sourceLinks
      };
      const contextHash = await sha256Hex(stableStringify(hashPayload));
      return {
        chainHost: baseContext.chainHost,
        contractAddress: baseContext.contractAddress,
        implementationAddress: baseContext.implementationAddress || '',
        contextHash,
        model: SUMMARY_MODEL,
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
        if (!await hasOpenRouterApiKey()) return;
        await generateContractSummary({ bypassCache: false, reloadContext: false, automatic: true });
      } catch (e) {
        console.log('Auto summary error:', e?.message || e);
      }
    }

    async function generateContractSummary({ bypassCache = false, reloadContext = false, automatic = false } = {}) {
      const startedAt = performance.now();
      try {
        setSummaryState(summaryPanel, 'loading', { message: automatic ? 'Auto summarizing...' : (reloadContext ? 'Reloading context...' : 'Building context...') });
        let cacheParams = null;
        if (!bypassCache && !reloadContext) {
          cacheParams = await buildSummaryCacheParams();
          const cacheKey = stableStringify(cacheParams);
          if (summaryCacheMissKey !== cacheKey) {
            const cached = await fetchContractSummaryCache(settings, cacheParams);
            if (cached?.summary_json) {
              latestSummaryResult = { source: 'cached', summary: cached.summary_json };
              setSummaryState(summaryPanel, 'cached', {
                message: 'Cached summary',
                summary: cached.summary_json
              });
              return;
            }
            summaryCacheMissKey = cacheKey;
          }
        }

        const { context, contextHash } = await buildSummaryContext({ reloadContext });
        cacheParams = {
          chainHost: context.chainHost,
          contractAddress: context.contractAddress,
          implementationAddress: context.implementationAddress || '',
          contextHash,
          model: SUMMARY_MODEL,
          promptVersion: SUMMARY_PROMPT_VERSION
        };

        setSummaryState(summaryPanel, 'loading', { message: 'Asking OpenRouter...' });
        const response = await chromeMessage({
          type: OPENROUTER_SUMMARY_TYPE,
          context,
          dedupeKey: stableStringify(cacheParams)
        });

        if (!response?.ok) {
          throw new Error(response?.error || 'OpenRouter summary failed.');
        }

        latestSummaryResult = { source: 'generated', summary: response.summary };
        setSummaryState(summaryPanel, 'generated', {
          message: `Generated summary ${formatElapsedTime(performance.now() - startedAt)}`,
          summary: response.summary
        });

        await storeContractSummaryCache(settings, {
          ...cacheParams,
          chainHost: context.chainHost,
          contractAddress: context.contractAddress,
          implementationAddress: context.implementationAddress || null,
          summary: response.summary
        });
      } catch (error) {
        setSummaryState(summaryPanel, 'error', { message: error?.message || String(error) });
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

    function isTokenUriQuestion(question) {
      return /\b(?:nft|token\s*uri|tokenuri|metadata|image|svg|animation)\b/i.test(question);
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

    function findTokenUriReadFunction() {
      const functions = latestSummaryContextBase?.functions || [];
      return functions.find(record => {
        const name = String(record?.signature || '').split('(')[0].toLowerCase();
        const paramTypes = splitTopLevelAbiTypes(record?.args || '').map(normalizeAbiType).filter(Boolean);
        return record?.isRead
          && record.signature !== 'Unknown'
          && (name === 'tokenuri' || name === 'nfttokenuri' || name.endsWith('tokenuri'))
          && paramTypes.length === 1
          && /^uint(?:[0-9]+)?$/.test(paramTypes[0]);
      }) || null;
    }

    function queryChatReadFunction(record, inputValues) {
      return new Promise(resolve => {
        const inputTypes = splitTopLevelAbiTypes(record.args || '').map(normalizeAbiType).filter(Boolean);
        const requestId = `chat-tool-${Date.now()}-${record.selector.slice(2)}`;
        const timeout = window.setTimeout(() => {
          chatToolReadRequests.delete(requestId);
          resolve({
            success: false,
            selector: record.selector,
            signature: record.signature,
            error: 'Read query timed out'
          });
        }, 10000);

        chatToolReadRequests.set(requestId, payload => {
          window.clearTimeout(timeout);
          resolve({
            success: !!payload.success,
            selector: record.selector,
            signature: record.signature,
            result: payload.success ? String(payload.result ?? '') : null,
            error: payload.success ? null : String(payload.error || 'Read query failed')
          });
        });

        window.postMessage({
          type: 'QUERY_READ_FUNCTION',
          purpose: CHAT_TOOL_READ_PURPOSE,
          requestId,
          selector: record.selector,
          signature: record.signature,
          contractAddress,
          inputTypes,
          inputValues
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

    function getTokenPreviewImageSrc(toolContext) {
      if (!toolContext || toolContext.kind !== 'token_uri_fetch') return '';
      const asset = toolContext.assetResource?.ok ? toolContext.assetResource : null;
      const token = toolContext.tokenResource?.ok ? toolContext.tokenResource : null;

      if (asset) {
        const assetUri = String(toolContext.assetUri || asset.uri || '').trim();
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
        const tokenUri = String(toolContext.tokenUri || token.uri || '').trim();
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
      const tokenId = escapeHtml(toolContext.tokenId || '');
      return `<div class="evmole-chat-token-preview">
        <div class="evmole-chat-token-preview-label">Token ${tokenId} preview</div>
        <img src="${escapeHtml(src)}" alt="Token ${tokenId} preview" loading="lazy">
      </div>`;
    }

    async function buildChatToolContext(question) {
      if (!isTokenUriQuestion(question)) return null;

      const tokenUriFunction = findTokenUriReadFunction();
      if (!tokenUriFunction) return null;

      const tokenId = extractTokenId(question);
      if (!tokenId) {
        return {
          kind: 'missing_token_id',
          message: 'Which token ID should I use?'
        };
      }

      const read = await queryChatReadFunction(tokenUriFunction, [tokenId]);
      if (!read.success) {
        return {
          kind: 'token_uri_read',
          tokenId,
          function: tokenUriFunction.signature,
          read
        };
      }

      const tokenUri = String(read.result || '').trim();
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
        tokenId,
        function: tokenUriFunction.signature,
        read,
        tokenUri,
        tokenResource: compactTokenFetchResult(tokenResource),
        assetUri,
        assetResource: compactTokenFetchResult(assetResource)
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
        if (toolContext?.kind === 'missing_token_id') {
          loadingItem.classList.remove('loading');
          loadingItem.innerHTML = renderChatText(toolContext.message);
          chatHistory.push({ role: 'assistant', content: toolContext.message });
          return;
        }
        if (toolContext) {
          context.toolContext = toolContext;
        }
        const response = await chromeMessage({
          type: OPENROUTER_CHAT_TYPE,
          question: trimmed,
          context,
          history: chatHistory.slice(0, -1)
        });

        if (!response?.ok) {
          throw new Error(response?.error || 'OpenRouter chat failed.');
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
      submitChatQuestion(question);
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

    const messageHandler = async function(event) {
      if (event.data && event.data.type === 'FUNCTION_SELECTORS_RESULT') {
        if (event.data.selectors && Array.isArray(event.data.selectors) && event.data.selectors.length > 0) {
          const readFunctions = [];
          const writeFunctions = [];
          const selectorRecords = [];

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

            selectorRecords.push({
              selector: selectorId,
              args,
              mutability,
              signature: functionName,
              isRead: isReadFunction,
              isUnknown: functionName === 'Unknown'
            });

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
            const verifiedAbi = getVerifiedContractAbi();
            const verifiedFunctions = Array.isArray(verifiedAbi)
              ? verifiedAbi.filter(entry => entry?.type === 'function').slice(0, 200)
              : [];
            latestSummaryContextBase = {
              promptVersion: SUMMARY_PROMPT_VERSION,
              model: SUMMARY_MODEL,
              chainHost: window.location.hostname,
              pageUrl: window.location.href,
              contractAddress,
              implementationAddress: event.data.implementationAddress || null,
              bytecodeSource: event.data.bytecodeSource || null,
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
        if (purpose === SUMMARY_READ_PURPOSE) {
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
