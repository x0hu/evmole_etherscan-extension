const DEFAULT_SETTINGS = {
  contractFunctionsDefaultCollapsed: true,
  signatureDatabaseUrl: '',
  signatureDatabaseStoreUnknowns: false,
  summaryProvider: 'openrouter',
  codexFastMode: false,
  codexReasoningEffort: 'low'
};
const CODEX_STATUS_TYPE = 'EVMOLE_CODEX_STATUS';
const CODEX_LOGIN_TYPE = 'EVMOLE_CODEX_LOGIN';
const CODEX_LOGOUT_TYPE = 'EVMOLE_CODEX_LOGOUT';

const statusEl = document.getElementById('status');
const radios = Array.from(document.querySelectorAll('input[name="contractFunctionsDefault"]'));
const providerRadios = Array.from(document.querySelectorAll('input[name="summaryProvider"]'));
const signatureDatabaseUrlInput = document.getElementById('signatureDatabaseUrl');
const signatureDatabaseStoreUnknownsInput = document.getElementById('signatureDatabaseStoreUnknowns');
const openRouterSection = document.getElementById('openRouterSection');
const openRouterApiKeyInput = document.getElementById('openRouterApiKey');
const saveOpenRouterApiKeyButton = document.getElementById('saveOpenRouterApiKey');
const clearOpenRouterApiKeyButton = document.getElementById('clearOpenRouterApiKey');
const codexSection = document.getElementById('codexSection');
const codexStatusText = document.getElementById('codexStatusText');
const codexDeviceCode = document.getElementById('codexDeviceCode');
const codexFastModeInput = document.getElementById('codexFastMode');
const loginCodexButton = document.getElementById('loginCodex');
const logoutCodexButton = document.getElementById('logoutCodex');
let statusTimer;
let codexStatusTimer;

function setStatus(message) {
  window.clearTimeout(statusTimer);
  statusEl.textContent = message;
  if (message) {
    statusTimer = window.setTimeout(() => {
      statusEl.textContent = '';
    }, 1800);
  }
}

function selectDefaultState(collapsed) {
  const value = collapsed ? 'collapsed' : 'expanded';
  const radio = radios.find(input => input.value === value);
  if (radio) radio.checked = true;
}

function selectSummaryProvider(provider) {
  const value = provider === 'codex' ? 'codex' : 'openrouter';
  const radio = providerRadios.find(input => input.value === value);
  if (radio) radio.checked = true;
  openRouterSection.hidden = value !== 'openrouter';
  codexSection.hidden = value !== 'codex';
}

function normalizeResolverUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (e) {
    return null;
  }
}

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.sync;
}

function hasChromeLocalStorage() {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

function chromeMessage(message) {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve({ ok: false, error: 'Extension runtime unavailable.' });
      return;
    }

    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || 'Extension message failed.' });
        return;
      }
      resolve(response || { ok: false, error: 'No response from background worker.' });
    });
  });
}

function restoreSettings() {
  if (!hasChromeStorage()) {
    selectDefaultState(DEFAULT_SETTINGS.contractFunctionsDefaultCollapsed);
    selectSummaryProvider(DEFAULT_SETTINGS.summaryProvider);
    refreshCodexStatus();
    return;
  }

  chrome.storage.sync.get(DEFAULT_SETTINGS, settings => {
    if (chrome.runtime.lastError) {
      selectDefaultState(DEFAULT_SETTINGS.contractFunctionsDefaultCollapsed);
      selectSummaryProvider(DEFAULT_SETTINGS.summaryProvider);
      setStatus('Could not load settings.');
      return;
    }

    selectDefaultState(settings.contractFunctionsDefaultCollapsed);
    selectSummaryProvider(settings.summaryProvider);
    codexFastModeInput.checked = !!settings.codexFastMode;
    signatureDatabaseUrlInput.value = settings.signatureDatabaseUrl || '';
    signatureDatabaseStoreUnknownsInput.checked = !!settings.signatureDatabaseStoreUnknowns;
  });

  if (hasChromeLocalStorage()) {
    chrome.storage.local.get({ openRouterApiKey: '' }, settings => {
      if (chrome.runtime.lastError) {
        setStatus('Could not load OpenRouter key.');
        return;
      }

      openRouterApiKeyInput.value = settings.openRouterApiKey ? '••••••••••••••••' : '';
      openRouterApiKeyInput.dataset.hasSavedKey = settings.openRouterApiKey ? 'true' : 'false';
    });
  }

  refreshCodexStatus();
}

function saveDefaultState(value) {
  const contractFunctionsDefaultCollapsed = value === 'collapsed';

  if (!hasChromeStorage()) {
    selectDefaultState(contractFunctionsDefaultCollapsed);
    setStatus('Saved.');
    return;
  }

  chrome.storage.sync.set({ contractFunctionsDefaultCollapsed }, () => {
    if (chrome.runtime.lastError) {
      setStatus('Could not save setting.');
      return;
    }

    setStatus('Saved.');
  });
}

function saveSummaryProvider(value) {
  const summaryProvider = value === 'codex' ? 'codex' : 'openrouter';
  selectSummaryProvider(summaryProvider);

  if (!hasChromeStorage()) {
    setStatus('Saved.');
    return;
  }

  chrome.storage.sync.set({ summaryProvider }, () => {
    if (chrome.runtime.lastError) {
      setStatus('Could not save provider.');
      return;
    }
    setStatus('Provider saved.');
  });
}

function saveCodexFastMode() {
  const codexFastMode = !!codexFastModeInput.checked;

  if (!hasChromeStorage()) {
    setStatus('Saved.');
    return;
  }

  chrome.storage.sync.set({ codexFastMode }, () => {
    if (chrome.runtime.lastError) {
      setStatus('Could not save fast mode.');
      return;
    }
    setStatus('Fast mode saved.');
  });
}

function saveSignatureDatabaseSettings() {
  const signatureDatabaseUrl = normalizeResolverUrl(signatureDatabaseUrlInput.value);
  if (signatureDatabaseUrl === null) {
    setStatus('Enter an http(s) resolver URL.');
    return;
  }

  const signatureDatabaseStoreUnknowns = signatureDatabaseStoreUnknownsInput.checked;

  if (!hasChromeStorage()) {
    signatureDatabaseUrlInput.value = signatureDatabaseUrl;
    setStatus('Saved.');
    return;
  }

  chrome.storage.sync.set({ signatureDatabaseUrl, signatureDatabaseStoreUnknowns }, () => {
    if (chrome.runtime.lastError) {
      setStatus('Could not save setting.');
      return;
    }

    signatureDatabaseUrlInput.value = signatureDatabaseUrl;
    setStatus('Saved.');
  });
}

function renderCodexStatus(response) {
  const status = response?.status || 'logged_out';
  window.clearTimeout(codexStatusTimer);

  if (status === 'pending') {
    codexStatusText.textContent = 'Login pending. Enter this code in the browser.';
    codexDeviceCode.hidden = false;
    codexDeviceCode.textContent = response.userCode || '';
    loginCodexButton.style.display = 'none';
    loginCodexButton.disabled = true;
    logoutCodexButton.style.display = '';
    logoutCodexButton.disabled = false;
    codexStatusTimer = window.setTimeout(refreshCodexStatus, Math.max(2000, Number(response.intervalSeconds || 5) * 1000));
    return;
  }

  codexDeviceCode.hidden = true;
  codexDeviceCode.textContent = '';
  loginCodexButton.style.display = status === 'logged_in' ? 'none' : '';
  loginCodexButton.disabled = status === 'logged_in';
  logoutCodexButton.style.display = '';
  logoutCodexButton.disabled = status === 'logged_out';

  if (status === 'logged_in') {
    const expires = response.expires
      ? new Date(response.expires).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    codexStatusText.textContent = expires ? `Logged in. Expires ${expires}.` : 'Logged in.';
  } else if (status === 'expired') {
    codexStatusText.textContent = 'Login expired. Codex will refresh on next use or ask you to login again.';
  } else if (status === 'error') {
    codexStatusText.textContent = response.error || 'Could not load Codex status.';
  } else {
    codexStatusText.textContent = 'Logged out.';
  }
}

async function refreshCodexStatus() {
  const response = await chromeMessage({ type: CODEX_STATUS_TYPE });
  renderCodexStatus(response);
}

async function loginCodex() {
  loginCodexButton.disabled = true;
  setStatus('Starting Codex login...');
  const response = await chromeMessage({ type: CODEX_LOGIN_TYPE });
  if (!response?.ok) {
    loginCodexButton.disabled = false;
    setStatus(response?.error || 'Could not start Codex login.');
    renderCodexStatus({ status: 'error', error: response?.error || 'Could not start Codex login.' });
    return;
  }

  renderCodexStatus(response);
  setStatus('Codex login started.');
  const verificationUri = response.verificationUri || 'https://auth.openai.com/codex/device';
  chrome.tabs?.create?.({ url: verificationUri });
}

async function logoutCodex() {
  const response = await chromeMessage({ type: CODEX_LOGOUT_TYPE });
  if (!response?.ok) {
    setStatus(response?.error || 'Could not logout Codex.');
    return;
  }
  renderCodexStatus({ status: 'logged_out' });
  setStatus('Codex logged out.');
}

function saveOpenRouterApiKey() {
  const openRouterApiKey = openRouterApiKeyInput.value.trim();
  if (!openRouterApiKey || openRouterApiKey === '••••••••••••••••') {
    setStatus(openRouterApiKeyInput.dataset.hasSavedKey === 'true' ? 'OpenRouter key unchanged.' : 'Enter an OpenRouter key.');
    return;
  }

  if (!hasChromeLocalStorage()) {
    setStatus('Saved.');
    return;
  }

  chrome.storage.local.set({ openRouterApiKey }, () => {
    if (chrome.runtime.lastError) {
      setStatus('Could not save OpenRouter key.');
      return;
    }

    openRouterApiKeyInput.value = '••••••••••••••••';
    openRouterApiKeyInput.dataset.hasSavedKey = 'true';
    setStatus('OpenRouter key saved.');
  });
}

function clearOpenRouterApiKey() {
  openRouterApiKeyInput.value = '';
  openRouterApiKeyInput.dataset.hasSavedKey = 'false';

  if (!hasChromeLocalStorage()) {
    setStatus('Cleared.');
    return;
  }

  chrome.storage.local.remove('openRouterApiKey', () => {
    if (chrome.runtime.lastError) {
      setStatus('Could not clear OpenRouter key.');
      return;
    }

    setStatus('OpenRouter key cleared.');
  });
}

radios.forEach(radio => {
  radio.addEventListener('change', event => {
    saveDefaultState(event.target.value);
  });
});

providerRadios.forEach(radio => {
  radio.addEventListener('change', event => {
    saveSummaryProvider(event.target.value);
  });
});

codexFastModeInput.addEventListener('change', saveCodexFastMode);
signatureDatabaseUrlInput.addEventListener('change', saveSignatureDatabaseSettings);
signatureDatabaseUrlInput.addEventListener('blur', saveSignatureDatabaseSettings);
signatureDatabaseStoreUnknownsInput.addEventListener('change', saveSignatureDatabaseSettings);
saveOpenRouterApiKeyButton.addEventListener('click', saveOpenRouterApiKey);
clearOpenRouterApiKeyButton.addEventListener('click', clearOpenRouterApiKey);
loginCodexButton.addEventListener('click', loginCodex);
logoutCodexButton.addEventListener('click', logoutCodex);
openRouterApiKeyInput.addEventListener('focus', () => {
  if (openRouterApiKeyInput.dataset.hasSavedKey === 'true') {
    openRouterApiKeyInput.value = '';
  }
});

restoreSettings();
