const DEFAULT_SETTINGS = {
  contractFunctionsDefaultCollapsed: true
};

const statusEl = document.getElementById('status');
const radios = Array.from(document.querySelectorAll('input[name="contractFunctionsDefault"]'));
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

radios.forEach(radio => {
  radio.addEventListener('change', event => {
    saveDefaultState(event.target.value);
  });
});

restoreSettings();
