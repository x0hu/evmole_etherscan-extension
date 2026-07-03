import {
    CODEX_ENDPOINT,
    CODEX_MODEL,
    CODEX_PRIORITY_MODEL_LABEL,
    CODEX_TIMEOUT_MS,
    OPENROUTER_ENDPOINT,
    OPENROUTER_MODEL,
    OPENROUTER_SUMMARY_ATTEMPT_TIMEOUT_MS,
    OPENROUTER_TIMEOUT_MS,
    SUMMARY_PROMPT_VERSION,
    SUMMARY_SYSTEM_PROMPT,
    SUMMARY_USER_PROMPT_PREFIX,
} from './constants.js';
import { getValidCodexCredentials } from './codex-auth.js';
import {
    buildCodexSummaryRequestBody,
    extractJsonText,
    getMessageContentText,
    normalizeCodexReasoningEffort,
    readCodexSseText,
    summarizeRawOutputForError,
} from './codex-client.js';
import { getBackgroundDedupePromise, getDedupeKey } from './dedupe.js';
import { getOpenRouterApiKey } from './storage.js';

const openRouterSummaryInFlight = new Map();
const openRouterSummaryRecentResults = new Map();
const codexSummaryInFlight = new Map();
const codexSummaryRecentResults = new Map();

function buildSummaryRequestBody(context, { retry = false, jsonMode = true, providerSort = 'latency' } = {}) {
    const body = {
        model: OPENROUTER_MODEL,
        temperature: retry ? 0.15 : 0.1,
        max_tokens: retry ? 1800 : 1400,
        stream: false,
        provider: { sort: providerSort },
        messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            {
                role: 'user',
                content: `${SUMMARY_USER_PROMPT_PREFIX}\n${JSON.stringify(context)}${retry ? '\n\nThe previous attempt was empty or malformed. Return a complete, compact, non-empty json object only. Close every array and object.' : ''}${jsonMode ? '' : '\n\njson mode is unavailable for this fallback attempt. Still return only the raw json object with no markdown or prose.'}`
            },
        ],
    };

    if (jsonMode) {
        body.response_format = { type: 'json_object' };
    }

    return body;
}

export function normalizeSummaryPayload(payload, context = null) {
    const summary = payload && typeof payload === 'object' ? payload : {};
    const cleanText = value => String(value ?? '')
        .replace(/\s*,?\s*likely\s+18\s+decimals/ig, '')
        .replace(/\s*,?\s*probably\s+18\s+decimals/ig, '')
        .replace(/\s*\((decimals unknown),?\s*(?:likely|probably)\s+18\)/ig, ' ($1)')
        .replace(/\b(?:likely|probably)\s+18\b/ig, 'decimals unknown')
        .trim();
    const cleanAddress = value => {
        const match = String(value || '').match(/0x[a-fA-F0-9]{40}/);
        return match ? match[0] : '';
    };
    const inputCreator = summary.contract_creator && typeof summary.contract_creator === 'object'
        ? summary.contract_creator
        : {};
    const contextCreator = context?.contractCreator && typeof context.contractCreator === 'object'
        ? context.contractCreator
        : {};
    const creatorAddress = cleanAddress(inputCreator.address || inputCreator.value || contextCreator.address);
    const contractCreator = creatorAddress
        ? {
            address: creatorAddress,
            label: cleanText(inputCreator.label || contextCreator.label || 'Contract creator') || 'Contract creator',
            source: cleanText(inputCreator.source || contextCreator.source || 'explorer') || 'explorer',
        }
        : null;
    const normalizeFactEntry = entry => ({
        label: cleanText(entry?.label || ''),
        value: cleanText(entry?.value ?? ''),
        source: cleanText(entry?.source || ''),
    });
    const keepFact = entry => {
        const label = entry.label.toLowerCase();
        const source = entry.source.toLowerCase();
        if (label === 'hook flags' || label === 'hook permissions') return false;
        if (source.includes('contractidentifiers.hookflags') || source.includes('gethookpermissions()')) return false;
        return entry.label || entry.value;
    };
    const normalizedFacts = Array.isArray(summary.facts) ? summary.facts.map(normalizeFactEntry).filter(keepFact) : [];
    const baselineFacts = Array.isArray(context?.localSummaryBaseline?.facts)
        ? context.localSummaryBaseline.facts.map(normalizeFactEntry).filter(keepFact)
        : [];
    const factKey = entry => `${entry.label.toLowerCase().replace(/[^a-z0-9]/g, '')}:${entry.source.toLowerCase().replace(/\s/g, '')}`;
    const isTokenBaselineFact = entry => /^(name|decimals|supply|totalsupply|maxsupply|maxwallet)$/i.test(entry.label.replace(/\s+/g, ''));
    const mergedFacts = [];
    for (const entry of normalizedFacts) {
        if (!mergedFacts.some(existing => factKey(existing) === factKey(entry))) mergedFacts.push(entry);
    }
    for (const entry of baselineFacts.filter(isTokenBaselineFact)) {
        const labelKey = entry.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sourceKey = entry.source.toLowerCase().replace(/\s/g, '');
        const hasSameFact = mergedFacts.some(existing => {
            const existingLabel = existing.label.toLowerCase().replace(/[^a-z0-9]/g, '');
            const existingSource = existing.source.toLowerCase().replace(/\s/g, '');
            const existingSourceText = existing.source.toLowerCase();
            const sourceText = entry.source.toLowerCase();
            const sameMaxWalletSource = (sourceText.includes('max_wallet()') && existingSourceText.includes('max_wallet()'))
                || (sourceText.includes('maxwallet()') && existingSourceText.includes('maxwallet()'));
            return existingLabel === labelKey || (sourceKey && existingSource === sourceKey) || sameMaxWalletSource;
        });
        if (!hasSameFact) mergedFacts.push(entry);
    }
    const factPriority = entry => {
        const label = entry.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const source = entry.source.toLowerCase();
        if (label === 'name' || source.includes('name()') || source.includes('symbol()')) return 100;
        if (label === 'decimals' || source.includes('decimals()')) return 90;
        if (label === 'supply' || label === 'totalsupply' || source.includes('totalsupply()')) return 85;
        if (label === 'maxsupply' || source.includes('maxsupply()')) return 80;
        if (label === 'maxwallet' || source.includes('max_wallet()') || source.includes('maxwallet()')) return 75;
        return 50;
    };
    const prioritizedFacts = mergedFacts
        .map((entry, index) => ({ entry, index, priority: factPriority(entry) }))
        .sort((a, b) => b.priority - a.priority || a.index - b.index)
        .slice(0, 4)
        .map(item => item.entry);

    return {
        summary: cleanText(summary.summary || ''),
        contract_creator: contractCreator,
        facts: prioritizedFacts,
        contract_type: cleanText(summary.contract_type || 'unknown') || 'unknown',
        confidence: ['high', 'medium', 'low'].includes(summary.confidence) ? summary.confidence : 'low',
        key_behaviors: Array.isArray(summary.key_behaviors) ? summary.key_behaviors.map(cleanText).slice(0, 2) : [],
        implementation_uniqueness: Array.isArray(summary.implementation_uniqueness) ? summary.implementation_uniqueness.map(cleanText).slice(0, 3) : [],
        read_context: Array.isArray(summary.read_context) ? summary.read_context.slice(0, 2).map(entry => ({
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

async function fetchOpenRouterSummary(apiKey, context) {
    const startedAt = Date.now();
    try {
        let payload = null;
        let contentText = '';
        let lastParseError = null;
        const attemptTimings = [];
        const attempts = [
            { retry: false, jsonMode: true, providerSort: 'throughput' },
            { retry: true, jsonMode: true, providerSort: 'throughput' },
            { retry: true, jsonMode: false, providerSort: 'latency' },
        ];

        for (let attempt = 0; attempt < attempts.length; attempt += 1) {
            const attemptConfig = attempts[attempt];
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), OPENROUTER_SUMMARY_ATTEMPT_TIMEOUT_MS);
            const attemptStartedAt = Date.now();
            const requestBody = JSON.stringify(buildSummaryRequestBody(context, attemptConfig));
            const requestBodyBytes = new TextEncoder().encode(requestBody).byteLength;
            let response;
            try {
                response = await fetch(OPENROUTER_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'X-Title': 'Evmole for Etherscan',
                    },
                    signal: controller.signal,
                    body: requestBody,
                });
            } catch (error) {
                const elapsedMs = Date.now() - attemptStartedAt;
                attemptTimings.push({
                    attempt: attempt + 1,
                    elapsedMs,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    requestBodyBytes,
                    outcome: error?.name === 'AbortError' ? 'timeout' : 'network_error',
                });
                if (error?.name !== 'AbortError') {
                    throw error;
                }
                lastParseError = `timeout after ${OPENROUTER_SUMMARY_ATTEMPT_TIMEOUT_MS / 1000}s`;
                console.warn('OpenRouter summary attempt timed out:', {
                    attempt: attempt + 1,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                });
                continue;
            } finally {
                clearTimeout(timeout);
            }

            payload = await response.json().catch(() => null);
            if (!response.ok) {
                attemptTimings.push({
                    attempt: attempt + 1,
                    elapsedMs: Date.now() - attemptStartedAt,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    requestBodyBytes,
                    status: response.status,
                    outcome: 'http_error',
                });
                throw new Error(payload?.error?.message || payload?.error || `OpenRouter failed with HTTP ${response.status}`);
            }

            const content = payload?.choices?.[0]?.message?.content;
            contentText = getMessageContentText(content);
            console.log('OpenRouter summary raw content:', contentText);
            const jsonText = extractJsonText(contentText);
            if (!jsonText) {
                const choice = payload?.choices?.[0] || {};
                lastParseError = `empty content, finish_reason: ${choice.finish_reason || choice.native_finish_reason || 'unknown'}`;
                attemptTimings.push({
                    attempt: attempt + 1,
                    elapsedMs: Date.now() - attemptStartedAt,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    requestBodyBytes,
                    finish_reason: choice.finish_reason || choice.native_finish_reason || 'unknown',
                    usage: payload?.usage || null,
                    outcome: 'empty_content',
                });
                console.warn('OpenRouter summary returned empty content:', {
                    attempt: attempt + 1,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    finish_reason: payload?.choices?.[0]?.finish_reason || null,
                    native_finish_reason: payload?.choices?.[0]?.native_finish_reason || null,
                    usage: payload?.usage || null,
                    message_keys: Object.keys(payload?.choices?.[0]?.message || {}),
                });
                continue;
            }

            try {
                const parsed = JSON.parse(jsonText);
                const choice = payload?.choices?.[0] || {};
                attemptTimings.push({
                    attempt: attempt + 1,
                    elapsedMs: Date.now() - attemptStartedAt,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    requestBodyBytes,
                    finish_reason: choice.finish_reason || choice.native_finish_reason || 'unknown',
                    usage: payload?.usage || null,
                    outcome: 'success',
                });
                return {
                    ok: true,
                    model: OPENROUTER_MODEL,
                    promptVersion: SUMMARY_PROMPT_VERSION,
                    summary: normalizeSummaryPayload(parsed, context),
                    usage: payload?.usage || null,
                    timing: {
                        totalMs: Date.now() - startedAt,
                        attempts: attemptTimings,
                    },
                };
            } catch (error) {
                const choice = payload?.choices?.[0] || {};
                lastParseError = `malformed JSON, finish_reason: ${choice.finish_reason || choice.native_finish_reason || 'unknown'}`;
                attemptTimings.push({
                    attempt: attempt + 1,
                    elapsedMs: Date.now() - attemptStartedAt,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    requestBodyBytes,
                    finish_reason: choice.finish_reason || choice.native_finish_reason || 'unknown',
                    usage: payload?.usage || null,
                    outcome: 'malformed_json',
                });
                console.warn('OpenRouter summary returned malformed JSON:', {
                    attempt: attempt + 1,
                    jsonMode: attemptConfig.jsonMode,
                    providerSort: attemptConfig.providerSort,
                    error: error?.message || String(error),
                    finish_reason: choice.finish_reason || null,
                    native_finish_reason: choice.native_finish_reason || null,
                    usage: payload?.usage || null,
                    preview: summarizeRawOutputForError(contentText),
                });
            }
        }

        throw new Error(`OpenRouter returned non-JSON summary output (${lastParseError || 'unknown reason'}): ${summarizeRawOutputForError(contentText) || 'empty output'}`);
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`OpenRouter summary timed out after ${OPENROUTER_SUMMARY_ATTEMPT_TIMEOUT_MS / 1000}s`);
        }
        throw error;
    }
}

async function fetchCodexSummary(credentials, context, { fastMode = false, reasoningEffort = 'low' } = {}) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CODEX_TIMEOUT_MS);
    const body = JSON.stringify(buildCodexSummaryRequestBody(context, { fastMode, reasoningEffort }));
    const requestBodyBytes = new TextEncoder().encode(body).byteLength;
    const contextBytes = new TextEncoder().encode(JSON.stringify(context || {})).byteLength;

    try {
        const response = await fetch(CODEX_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.access}`,
                'chatgpt-account-id': credentials.accountId,
                'originator': 'evmole',
                'OpenAI-Beta': 'responses=experimental',
                'accept': 'text/event-stream',
                'content-type': 'application/json',
            },
            signal: controller.signal,
            body,
        });
        const responseHeadersMs = Date.now() - startedAt;
        const responseHeaderDiagnostics = {
            requestId: response.headers.get('x-request-id') || response.headers.get('openai-request-id') || '',
            cfRay: response.headers.get('cf-ray') || '',
            contentType: response.headers.get('content-type') || '',
            serverTiming: response.headers.get('server-timing') || '',
        };

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Codex summary failed with HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 240)}` : ''}`);
        }

        const { text: contentText, timing: sseTiming } = await readCodexSseText(response, controller.signal, { startedAt });
        console.log('Codex summary raw content:', contentText);
        const jsonText = extractJsonText(contentText);
        if (!jsonText) {
            throw new Error(`Codex returned empty summary output: ${summarizeRawOutputForError(contentText) || 'empty output'}`);
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (error) {
            throw new Error(`Codex returned malformed JSON summary output: ${summarizeRawOutputForError(contentText) || error?.message || 'parse failed'}`);
        }
        const totalMs = Date.now() - startedAt;
        const timing = {
            totalMs,
            requestBodyBytes,
            contextBytes,
            responseHeadersMs,
            responseHeaders: responseHeaderDiagnostics,
            outputChars: contentText.length,
            fastMode: !!fastMode,
            reasoningEffort: normalizeCodexReasoningEffort(reasoningEffort),
            ...sseTiming,
        };
        console.info('Codex summary timing:', timing);

        return {
            ok: true,
            model: fastMode ? CODEX_PRIORITY_MODEL_LABEL : CODEX_MODEL,
            promptVersion: SUMMARY_PROMPT_VERSION,
            summary: normalizeSummaryPayload(parsed, context),
            usage: null,
            timing,
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`Codex summary timed out after ${CODEX_TIMEOUT_MS / 1000}s`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function handleCodexSummary(message, sendResponse) {
    const context = message?.context;
    if (!context || typeof context !== 'object') {
        sendResponse({ ok: false, error: 'Missing contract summary context.' });
        return;
    }

    const dedupeKey = getDedupeKey(message);

    try {
        const summaryPromise = getBackgroundDedupePromise(
            codexSummaryInFlight,
            codexSummaryRecentResults,
            dedupeKey,
            async () => {
                const credentials = await getValidCodexCredentials();
                return fetchCodexSummary(credentials, context, {
                    fastMode: !!message?.fastMode,
                    reasoningEffort: normalizeCodexReasoningEffort(message?.reasoningEffort),
                });
            }
        );
        sendResponse(await summaryPromise);
    } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
    }
}

export async function handleOpenRouterSummary(message, sendResponse) {
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

    const dedupeKey = getDedupeKey(message);

    try {
        const summaryPromise = getBackgroundDedupePromise(
            openRouterSummaryInFlight,
            openRouterSummaryRecentResults,
            dedupeKey,
            () => fetchOpenRouterSummary(apiKey, context)
        );
        sendResponse(await summaryPromise);
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? `OpenRouter summary timed out after ${OPENROUTER_TIMEOUT_MS / 1000}s`
            : error?.message || String(error);
        sendResponse({ ok: false, error: message });
    }
}
