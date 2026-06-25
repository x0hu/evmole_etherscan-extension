// Page-context bridge for switching native Etherscan event log data views.
(function() {
  'use strict';

  if (window.__EVMOLE_EVENTLOG_VIEW_BRIDGE__) return;
  window.__EVMOLE_EVENTLOG_VIEW_BRIDGE__ = true;

  const VIEW_EVENT_NAME = 'EVMOLE_EVENTLOG_SET_VIEW';

  function setDisplay(id, visible) {
    const element = document.getElementById(id);
    if (element) element.style.display = visible ? '' : 'none';
  }

  function normalizeEventNumber(value) {
    const eventNumber = String(value || '').replace(/[^\d]/g, '');
    return eventNumber || null;
  }

  function setFallbackView(eventNumber, mode) {
    setDisplay(`event_raw_data_${eventNumber}`, mode === 'hex');
    setDisplay(`event_dec_data_${eventNumber}`, mode === 'dec');
    setDisplay(`event_achoc_${eventNumber}`, mode === 'abi');
  }

  function preserveScroll(callback) {
    const x = window.scrollX;
    const y = window.scrollY;

    callback();

    window.scrollTo(x, y);
    window.requestAnimationFrame(() => window.scrollTo(x, y));
    window.setTimeout(() => window.scrollTo(x, y), 0);
  }

  function setNativeView(eventNumber, mode) {
    try {
      if (mode === 'abi' && typeof window.decodeevent === 'function') {
        preserveScroll(() => {
          window.decodeevent(eventNumber);
          setFallbackView(eventNumber, 'abi');
        });
        return;
      }

      if ((mode === 'dec' || mode === 'hex') && typeof window.convertEventData === 'function') {
        preserveScroll(() => {
          window.convertEventData(mode, eventNumber);
          setDisplay(`event_achoc_${eventNumber}`, false);
        });
        return;
      }
    } catch (error) {
      console.warn('[event_log_decoder] native event log view switch failed:', error);
    }

    setFallbackView(eventNumber, mode);
  }

  window.addEventListener(VIEW_EVENT_NAME, event => {
    const eventNumber = normalizeEventNumber(event.detail?.eventNumber);
    const mode = event.detail?.mode;
    if (!eventNumber || !['dec', 'abi', 'hex'].includes(mode)) return;

    setNativeView(eventNumber, mode);
  });
})();
