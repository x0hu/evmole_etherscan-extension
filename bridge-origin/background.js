const BRIDGE_ORIGIN_LOOKUP_TYPE = 'EVMOLE_BRIDGE_ORIGIN_LOOKUP';
const BRIDGE_FETCH_ENDPOINT = 'https://bridge-fetchagg.vercel.app/api/transaction-hash';
const BRIDGE_FETCH_TIMEOUT_MS = 6500;
const OPENROUTER_SUMMARY_TYPE = 'EVMOLE_OPENROUTER_SUMMARY';
const OPENROUTER_STATUS_TYPE = 'EVMOLE_OPENROUTER_STATUS';
const OPENROUTER_CHAT_TYPE = 'EVMOLE_OPENROUTER_CHAT';
const FETCH_TOKEN_URI_TYPE = 'EVMOLE_FETCH_TOKEN_URI';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';
const OPENROUTER_TIMEOUT_MS = 45000;
const TOKEN_URI_FETCH_TIMEOUT_MS = 8500;
const TOKEN_URI_MAX_BYTES = 1024 * 1024;
const SUMMARY_PROMPT_VERSION = 'evmole-contract-summary-v5-decimals-fallback';
const SUMMARY_SYSTEM_PROMPT = `You are Evmole's concise EVM contract analyst. Use only the supplied evidence. Do not invent behavior from function names alone. Prioritize interpreted facts and numbers first: contribution amounts, max raise, min/max buys, taxes/fees, timestamps, cooldowns, bonding-curve parameters, routers/pairs, and privileged roles. Convert wei/token units and epoch timestamps when direct evidence supports the conversion. For token amounts, never assume decimals: only convert raw token integers when a decimals() read result is present in the evidence. Keep prose short and put explanations after facts. Never claim safety or give investment advice. Return only valid JSON.`;
const openRouterSummaryInFlight = new Map();
const SUMMARY_USER_PROMPT_PREFIX = `Analyze this EVM contract from the supplied evidence.

Required JSON shape:
{
  "facts": [
    { "label": "Max raise", "value": "30 ETH", "source": "maxRaiseWeth()" },
    { "label": "Per contributor", "value": "1 ETH", "source": "contributionAmount()" }
  ],
  "summary": "1 short sentence explaining what the contract appears to do.",
  "contract_type": "token|router|factory|proxy|vault|nft|governance|unknown|other",
  "confidence": "high|medium|low",
  "key_behaviors": ["up to 2 concise interpreted behaviors"],
  "read_context": [
    {
      "name": "function signature or selector",
      "value": "decoded and converted value",
      "meaning": "why this value matters",
      "confidence": "high|medium|low"
    }
  ],
  "limits_taxes_and_rules": ["up to 3 concise taxes, min/max amounts, cooldowns, launch windows, bonding curve parameters, or empty array"],
  "privileged_controls": ["up to 2 owner/admin/operator controls or empty array"]
}

Rules:
- Return compact JSON only. No markdown, comments, code fences, or explanatory text outside JSON.
- Put at most 5 concrete facts in "facts" first. Use short labels like "Per contributor", "Max contributors", "Sale window", "Buy tax", "Sell tax", "Cooldown", "Router", "Pair", "Bonding curve".
- Do not write raw variable-style explanations when a converted interpretation is possible. Prefer "1 ETH per contributor" over "contributionAmount is 1000000000000000000".
- For ERC-20-style token amounts such as maxSupply, totalSupply, totalMinted, maxWallet, or maxTx, cite decimals() when converting. If decimals() is missing or failed, show the raw integer and say decimals are unknown.
- Never write "likely 18", "probably 18", or any guessed decimals value.
- Include raw function names only in "source" or read_context.
- If a number is inferred from multiple reads, state the interpreted result and cite the sources.

Evidence JSON:`;

function buildSummaryRequestBody(context, { retry = false } = {}) {
    return {
        model: OPENROUTER_MODEL,
        temperature: retry ? 0.2 : 0.1,
        max_tokens: retry ? 1400 : 1200,
        stream: false,
        provider: { sort: 'latency' },
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            {
                role: 'user',
                content: `${SUMMARY_USER_PROMPT_PREFIX}\n${JSON.stringify(context)}${retry ? '\n\nThe previous attempt was empty or malformed. Return a complete, compact, non-empty JSON object only. Close every array and object.' : ''}`
            },
        ],
    };
}

function getOpenRouterApiKey() {
    return new Promise(resolve => {
        if (!chrome.storage?.local) {
            resolve('');
            return;
        }

        chrome.storage.local.get({ openRouterApiKey: '' }, settings => {
            if (chrome.runtime.lastError) {
                resolve('');
                return;
            }

            resolve(String(settings.openRouterApiKey || '').trim());
        });
    });
}

function extractJsonText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';

    const fenced = trimmed.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }

    return trimmed;
}

function getMessageContentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            return part?.text || part?.content || '';
        }).join('\n');
    }
    if (content && typeof content === 'object') {
        return JSON.stringify(content);
    }
    return '';
}

function summarizeRawOutputForError(content) {
    const text = getMessageContentText(content).replace(/\s+/g, ' ').trim();
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function normalizeSummaryPayload(payload) {
    const summary = payload && typeof payload === 'object' ? payload : {};
    const cleanText = value => String(value ?? '')
        .replace(/\s*,?\s*likely\s+18\s+decimals/ig, '')
        .replace(/\s*,?\s*probably\s+18\s+decimals/ig, '')
        .replace(/\s*\((decimals unknown),?\s*(?:likely|probably)\s+18\)/ig, ' ($1)')
        .replace(/\b(?:likely|probably)\s+18\b/ig, 'decimals unknown')
        .trim();
    return {
        summary: cleanText(summary.summary || ''),
        facts: Array.isArray(summary.facts) ? summary.facts.slice(0, 6).map(entry => ({
            label: cleanText(entry?.label || ''),
            value: cleanText(entry?.value ?? ''),
            source: cleanText(entry?.source || ''),
        })).filter(entry => entry.label || entry.value) : [],
        contract_type: cleanText(summary.contract_type || 'unknown') || 'unknown',
        confidence: ['high', 'medium', 'low'].includes(summary.confidence) ? summary.confidence : 'low',
        key_behaviors: Array.isArray(summary.key_behaviors) ? summary.key_behaviors.map(cleanText).slice(0, 3) : [],
        read_context: Array.isArray(summary.read_context) ? summary.read_context.slice(0, 3).map(entry => ({
            name: cleanText(entry?.name || ''),
            value: cleanText(entry?.value ?? ''),
            meaning: cleanText(entry?.meaning || ''),
            confidence: ['high', 'medium', 'low'].includes(entry?.confidence) ? entry.confidence : 'low',
        })).filter(entry => entry.name || entry.value || entry.meaning) : [],
        limits_taxes_and_rules: Array.isArray(summary.limits_taxes_and_rules) ? summary.limits_taxes_and_rules.map(cleanText).slice(0, 4) : [],
        privileged_controls: Array.isArray(summary.privileged_controls) ? summary.privileged_controls.map(cleanText).slice(0, 2) : [],
        unknowns: Array.isArray(summary.unknowns) ? summary.unknowns.slice(0, 3).map(entry => ({
            selector: cleanText(entry?.selector || ''),
            reason: cleanText(entry?.reason || ''),
            suggested_next_read: entry?.suggested_next_read === null || entry?.suggested_next_read === undefined
                ? null
                : cleanText(entry.suggested_next_read),
        })).filter(entry => entry.selector || entry.reason) : [],
        user_next_steps: Array.isArray(summary.user_next_steps) ? summary.user_next_steps.map(cleanText).slice(0, 2) : [],
        warnings: Array.isArray(summary.warnings) ? summary.warnings.map(cleanText).slice(0, 2) : [],
    };
}

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
        json: contentType.includes('json') ? tryParseJson(text) : tryParseJson(text),
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
            json: contentType.includes('json') ? tryParseJson(text) : tryParseJson(text),
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchOpenRouterSummary(apiKey, context) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
        let payload = null;
        let contentText = '';
        let lastParseError = null;

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await fetch(OPENROUTER_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Title': 'Evmole for Etherscan',
                },
                signal: controller.signal,
                body: JSON.stringify(buildSummaryRequestBody(context, { retry: attempt > 0 })),
            });

            payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.error?.message || payload?.error || `OpenRouter failed with HTTP ${response.status}`);
            }

            const content = payload?.choices?.[0]?.message?.content;
            contentText = getMessageContentText(content);
            console.log('OpenRouter summary raw content:', contentText);
            const jsonText = extractJsonText(contentText);
            if (!jsonText) {
                const choice = payload?.choices?.[0] || {};
                lastParseError = `empty content, finish_reason: ${choice.finish_reason || choice.native_finish_reason || 'unknown'}`;
                console.warn('OpenRouter summary returned empty content:', {
                    attempt: attempt + 1,
                    finish_reason: payload?.choices?.[0]?.finish_reason || null,
                    native_finish_reason: payload?.choices?.[0]?.native_finish_reason || null,
                    usage: payload?.usage || null,
                    message_keys: Object.keys(payload?.choices?.[0]?.message || {}),
                });
                continue;
            }

            try {
                const parsed = JSON.parse(jsonText);
                return {
                    ok: true,
                    model: OPENROUTER_MODEL,
                    promptVersion: SUMMARY_PROMPT_VERSION,
                    summary: normalizeSummaryPayload(parsed),
                    usage: payload?.usage || null,
                };
            } catch (error) {
                const choice = payload?.choices?.[0] || {};
                lastParseError = `malformed JSON, finish_reason: ${choice.finish_reason || choice.native_finish_reason || 'unknown'}`;
                console.warn('OpenRouter summary returned malformed JSON:', {
                    attempt: attempt + 1,
                    error: error?.message || String(error),
                    finish_reason: choice.finish_reason || null,
                    native_finish_reason: choice.native_finish_reason || null,
                    usage: payload?.usage || null,
                    preview: summarizeRawOutputForError(contentText),
                });
            }
        }

        throw new Error(`OpenRouter returned non-JSON summary output (${lastParseError || 'unknown reason'}): ${summarizeRawOutputForError(contentText) || 'empty output'}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function handleOpenRouterSummary(message, sendResponse) {
    const apiKey = await getOpenRouterApiKey();
    if (!apiKey) {
        sendResponse({ ok: false, error: 'Add an OpenRouter API key in the Evmole popup first.' });
        return;
    }

    const context = message?.context;
    if (!context || typeof context !== 'object') {
        sendResponse({ ok: false, error: 'Missing contract summary context.' });
        return;
    }

    const dedupeKey = typeof message?.dedupeKey === 'string' ? message.dedupeKey.slice(0, 500) : '';

    try {
        let summaryPromise = dedupeKey ? openRouterSummaryInFlight.get(dedupeKey) : null;
        if (!summaryPromise) {
            summaryPromise = fetchOpenRouterSummary(apiKey, context);
            if (dedupeKey) {
                openRouterSummaryInFlight.set(dedupeKey, summaryPromise);
                summaryPromise.then(
                    () => openRouterSummaryInFlight.delete(dedupeKey),
                    () => openRouterSummaryInFlight.delete(dedupeKey)
                );
            }
        }

        sendResponse(await summaryPromise);
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? `OpenRouter summary timed out after ${OPENROUTER_TIMEOUT_MS / 1000}s`
            : error?.message || String(error);
        sendResponse({ ok: false, error: message });
    }
}

async function handleOpenRouterChat(message, sendResponse) {
    const apiKey = await getOpenRouterApiKey();
    if (!apiKey) {
        sendResponse({ ok: false, error: 'Add an OpenRouter API key in the Evmole popup first.' });
        return;
    }

    const question = String(message?.question || '').trim();
    const context = message?.context;
    const history = Array.isArray(message?.history) ? message.history.slice(-8) : [];

    if (!question) {
        sendResponse({ ok: false, error: 'Ask a question first.' });
        return;
    }
    if (!context || typeof context !== 'object') {
        sendResponse({ ok: false, error: 'Contract context is not ready yet.' });
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
        const response = await fetch(OPENROUTER_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-Title': 'Evmole for Etherscan',
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                temperature: 0.15,
                max_tokens: 900,
                stream: false,
                messages: [
                    {
                        role: 'system',
                        content: 'You are Evmole contract chat. Answer questions about the current EVM contract using only the supplied evidence, toolContext, and prior chat. Be concise. If toolContext contains NFT metadata, image, SVG, or JSON, summarize the fetched facts directly without naming internal read functions unless the user asks. If evidence is missing, ask for the missing value plainly. Do not claim safety or give investment advice.'
                    },
                    {
                        role: 'user',
                        content: `Contract evidence JSON:\n${JSON.stringify(context)}`
                    },
                    ...history.map(entry => ({
                        role: entry.role === 'assistant' ? 'assistant' : 'user',
                        content: String(entry.content || '').slice(0, 2000)
                    })),
                    { role: 'user', content: question }
                ],
            }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(payload?.error?.message || payload?.error || `OpenRouter failed with HTTP ${response.status}`);
        }

        const answer = getMessageContentText(payload?.choices?.[0]?.message?.content).trim();
        if (!answer) throw new Error('OpenRouter returned an empty chat response.');

        sendResponse({
            ok: true,
            answer,
            model: OPENROUTER_MODEL,
            usage: payload?.usage || null,
        });
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? `OpenRouter chat timed out after ${OPENROUTER_TIMEOUT_MS / 1000}s`
            : error?.message || String(error);
        sendResponse({ ok: false, error: message });
    } finally {
        clearTimeout(timeout);
    }
}

async function handleFetchTokenUri(message, sendResponse) {
    try {
        sendResponse(await fetchTokenUriResource(message?.uri));
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? `Token URI fetch timed out after ${TOKEN_URI_FETCH_TIMEOUT_MS / 1000}s`
            : error?.message || String(error);
        sendResponse({ ok: false, error: message });
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === OPENROUTER_STATUS_TYPE) {
        getOpenRouterApiKey()
            .then(apiKey => sendResponse({ ok: true, hasKey: !!apiKey }))
            .catch(error => sendResponse({ ok: false, hasKey: false, error: error?.message || String(error) }));
        return true;
    }

    if (message?.type === OPENROUTER_SUMMARY_TYPE) {
        handleOpenRouterSummary(message, sendResponse);
        return true;
    }

    if (message?.type === OPENROUTER_CHAT_TYPE) {
        handleOpenRouterChat(message, sendResponse);
        return true;
    }

    if (message?.type === FETCH_TOKEN_URI_TYPE) {
        handleFetchTokenUri(message, sendResponse);
        return true;
    }

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
