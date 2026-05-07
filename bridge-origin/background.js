const BRIDGE_ORIGIN_LOOKUP_TYPE = 'EVMOLE_BRIDGE_ORIGIN_LOOKUP';
const BRIDGE_FETCH_ENDPOINT = 'https://bridge-fetchagg.vercel.app/api/transaction-hash';
const BRIDGE_FETCH_TIMEOUT_MS = 6500;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== BRIDGE_ORIGIN_LOOKUP_TYPE) {
        return false;
    }

    const txHash = String(message.txHash || '').trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        sendResponse({ ok: false, error: 'Invalid transaction hash' });
        return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRIDGE_FETCH_TIMEOUT_MS);

    fetch(`${BRIDGE_FETCH_ENDPOINT}?txHash=${encodeURIComponent(txHash)}`, {
        signal: controller.signal,
    })
        .then(async response => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.error || `Bridge lookup failed with HTTP ${response.status}`);
            }
            sendResponse({ ok: true, data: payload });
        })
        .catch(error => {
            const message = error?.name === 'AbortError'
                ? `Bridge lookup timed out after ${BRIDGE_FETCH_TIMEOUT_MS}ms`
                : error?.message || String(error);
            sendResponse({ ok: false, error: message });
        })
        .finally(() => {
            clearTimeout(timeout);
        });

    return true;
});
