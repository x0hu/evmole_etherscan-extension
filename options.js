const DEFAULT_SETTINGS = {
  contractFunctionsDefaultCollapsed: true,
  signatureDatabaseUrl: '',
  signatureDatabaseStoreUnknowns: false
};

const statusEl = document.getElementById('status');
const radios = Array.from(document.querySelectorAll('input[name="contractFunctionsDefault"]'));
const signatureDatabaseUrlInput = document.getElementById('signatureDatabaseUrl');
const signatureDatabaseStoreUnknownsInput = document.getElementById('signatureDatabaseStoreUnknowns');
let statusTimer;

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

function restoreSettings() {
  if (!hasChromeStorage()) {
    selectDefaultState(DEFAULT_SETTINGS.contractFunctionsDefaultCollapsed);
    return;
  }

  chrome.storage.sync.get(DEFAULT_SETTINGS, settings => {
    if (chrome.runtime.lastError) {
      selectDefaultState(DEFAULT_SETTINGS.contractFunctionsDefaultCollapsed);
      setStatus('Could not load settings.');
      return;
    }

    selectDefaultState(settings.contractFunctionsDefaultCollapsed);
    signatureDatabaseUrlInput.value = settings.signatureDatabaseUrl || '';
    signatureDatabaseStoreUnknownsInput.checked = !!settings.signatureDatabaseStoreUnknowns;
  });
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

radios.forEach(radio => {
  radio.addEventListener('change', event => {
    saveDefaultState(event.target.value);
  });
});

signatureDatabaseUrlInput.addEventListener('change', saveSignatureDatabaseSettings);
signatureDatabaseUrlInput.addEventListener('blur', saveSignatureDatabaseSettings);
signatureDatabaseStoreUnknownsInput.addEventListener('change', saveSignatureDatabaseSettings);

restoreSettings();
