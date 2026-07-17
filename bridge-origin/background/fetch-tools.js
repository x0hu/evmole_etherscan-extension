import {
    BRIDGE_FETCH_ENDPOINT,
    BRIDGE_FETCH_TIMEOUT_MS,
    TOKEN_URI_FETCH_TIMEOUT_MS,
    TOKEN_URI_MAX_BYTES,
} from './constants.js';

function decodeBase64Bytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function resolveFetchableTokenUri(rawUri) {
    const uri = String(rawUri || '').trim();
    if (!uri) throw new Error('Missing token URI.');
    if (uri.length > 12000) throw new Error('Token URI is too large to fetch.');
    if (/^data:/i.test(uri)) return { uri, fetchUrl: null };
    if (/^ipfs:\/\//i.test(uri)) {
        const path = uri.replace(/^ipfs:\/\//i, '').replace(/^ipfs\//i, '');
        if (!path) throw new Error('Invalid IPFS URI.');
        return { uri, fetchUrl: `https://ipfs.io/ipfs/${path}` };
    }
    if (/^https?:\/\//i.test(uri)) {
        const url = new URL(uri);
        return { uri, fetchUrl: url.toString() };
    }
    throw new Error('Only data:, ipfs://, http://, and https:// token URIs are supported.');
}

function decodeDataUri(uri) {
    const commaIndex = uri.indexOf(',');
    if (commaIndex === -1) throw new Error('Invalid data URI.');
    const meta = uri.slice(5, commaIndex);
    const data = uri.slice(commaIndex + 1);
    const parts = meta.split(';').filter(Boolean);
    const contentType = parts.find(part => !part.includes('=')) || 'text/plain';
    const isBase64 = parts.some(part => part.toLowerCase() === 'base64');
    let text;
    if (isBase64) {
        const bytes = decodeBase64Bytes(data);
        if (bytes.byteLength > TOKEN_URI_MAX_BYTES) throw new Error('Decoded data URI is too large.');
        text = new TextDecoder().decode(bytes);
    } else {
        text = decodeURIComponent(data);
        if (new TextEncoder().encode(text).byteLength > TOKEN_URI_MAX_BYTES) {
            throw new Error('Decoded data URI is too large.');
        }
    }
    return {
        ok: true,
        uri,
        fetchedUri: uri,
        contentType,
        text,
        json: tryParseJson(text),
    };
}

async function fetchTokenUriResource(rawUri) {
    const resolved = resolveFetchableTokenUri(rawUri);
    if (!resolved.fetchUrl) return decodeDataUri(resolved.uri);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_URI_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(resolved.fetchUrl, {
            headers: { 'Accept': 'application/json,image/svg+xml,text/plain,*/*' },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Token URI fetch failed with HTTP ${response.status}`);

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > TOKEN_URI_MAX_BYTES) throw new Error('Token URI response is too large.');

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > TOKEN_URI_MAX_BYTES) throw new Error('Token URI response is too large.');

        const contentType = response.headers.get('content-type') || '';
        const text = new TextDecoder().decode(buffer);
        return {
            ok: true,
            uri: resolved.uri,
            fetchedUri: resolved.fetchUrl,
            contentType,
            text,
            json: tryParseJson(text),
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function handleFetchTokenUri(message, sendResponse) {
    try {
        sendResponse(await fetchTokenUriResource(message?.uri));
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? `Token URI fetch timed out after ${TOKEN_URI_FETCH_TIMEOUT_MS / 1000}s`
            : error?.message || String(error);
        sendResponse({ ok: false, error: message });
    }
}

export function isValidBridgeLookupInput(value) {
    return /^0x[a-fA-F0-9]{64}$/.test(value) ||
        /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(value);
}

export function handleBridgeOriginLookup(message, sendResponse) {
    const txHash = String(message.txHash || '').trim();
    if (!isValidBridgeLookupInput(txHash)) {
        sendResponse({ ok: false, error: 'Invalid bridge lookup input' });
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
}
