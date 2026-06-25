// Page-context bridge for switching Etherscan transaction input data view.
(function() {
  'use strict';

  if (window.__EVMOLE_CALLDATA_VIEW_BRIDGE__) return;
  window.__EVMOLE_CALLDATA_VIEW_BRIDGE__ = true;

  const INPUT_VIEW_EVENT_NAME = 'EVMOLE_SET_INPUT_VIEW';

  function setInputView(mode) {
    const input = document.getElementById('inputdata');
    if (!input || typeof window.convertstr2 !== 'function') return;

    try {
      window.convertstr2(input.innerHTML || input.value || input.textContent || '', mode);
    } catch (error) {
      console.warn('[decode_calldata] native input view switch failed:', error);
    }
  }

  window.addEventListener(INPUT_VIEW_EVENT_NAME, event => {
    const mode = event.detail?.mode;
    if (!['default', 'hex', 'original'].includes(mode)) return;
    setInputView(mode);
  });
})();
