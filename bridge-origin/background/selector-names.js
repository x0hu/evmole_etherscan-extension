import {
    CODEX_ENDPOINT,
    CODEX_MODEL,
    CODEX_PRIORITY_MODEL_LABEL,
    CODEX_TIMEOUT_MS,
    SELECTOR_NAME_PROMPT_VERSION,
} from './constants.js';
import { getValidCodexCredentials } from './codex-auth.js';
import {
    buildCodexSelectorNamesRequestBody,
    extractJsonText,
    normalizeCodexReasoningEffort,
    readCodexSseText,
    summarizeRawOutputForError,
} from './codex-client.js';
import { getBackgroundDedupePromise, getDedupeKey } from './dedupe.js';

const selectorNamesInFlight = new Map();
const selectorNamesRecentResults = new Map();

export function normalizeSelectorId(value) {
    const selector = String(value || '').trim().toLowerCase();
    return /^0x[0-9a-f]{8}$/.test(selector) ? selector : '';
}

export function normalizeHeuristicName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const cleaned = raw
        .replace(/\([^)]*\)/g, '')
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    if (!cleaned) return '';
    const withPrefix = /^[A-Za-z_]/.test(cleaned) ? cleaned : `fn_${cleaned}`;
    return /^[A-Za-z_][A-Za-z0-9_]{1,79}$/.test(withPrefix) ? withPrefix : '';
}

const GENERIC_HEURISTIC_NAMES = new Set([
    'readconstant',
    'readflag',
    'readstoredvalue',
    'readaddressconfig',
    'readaddressvalue',
    'readindexedconfig',
    'readobservation',
    'readconfigtuple',
    'computescaledvalue',
    'unknownaction',
    'unknownread',
    'unknownfunction',
]);
const WRITE_ACTION_NAME_RE = /(set|update|write|configure|enable|disable|transfer|claim|withdraw|deposit|mint|burn|swap|execute|create|delete|remove|add|init|finalize)/i;
const ABI_SHAPE_NAME_RE = /(tuple|tuples|triple|triples|struct|structs)/i;
const VAGUE_COLLECTION_ACTION_RE = /^(batch)?(apply|process|handle|submit|commit)(records?|entries?|items?|values?|array|arrays)$/i;

function unknownSelectorContextBySelector(context = null) {
    return new Map((context?.unknownSelectors || [])
        .map(entry => [normalizeSelectorId(entry?.selector || entry), entry])
        .filter(([selector]) => selector));
}

function assessSelectorNameSemantics(entry, selectorContext) {
    const name = String(entry?.heuristicName || '');
    const lowerName = name.toLowerCase();
    const mutability = String(selectorContext?.mutability || '').toLowerCase();
    const args = String(selectorContext?.args || '').trim();
    const inputCount = Array.isArray(selectorContext?.inputTypes)
        ? selectorContext.inputTypes.length
        : (args && args !== '()' ? 1 : 0);

    if ((mutability === 'pure' || mutability === 'view') && WRITE_ACTION_NAME_RE.test(name)) {
        return `${mutability} selector named like a write/action function`;
    }
    if (mutability === 'pure' && (args === '()' || inputCount === 0) && !/^constant[A-Z0-9]/.test(name)) {
        return 'pure no-arg selector should be a specific constant-style name';
    }
    if (inputCount === 0 && /(by|for|of|at)$/.test(lowerName)) {
        return 'no-arg selector name implies a missing parameter';
    }
    if (inputCount > 0 && /^constant[A-Z0-9]/.test(name)) {
        return 'parameterized selector should not be named as a fixed no-arg constant';
    }
    if (ABI_SHAPE_NAME_RE.test(name)) {
        return 'selector name describes ABI tuple/struct shape instead of contract behavior';
    }
    if (VAGUE_COLLECTION_ACTION_RE.test(name)) {
        return 'selector name describes a vague collection action instead of contract behavior';
    }
    return '';
}

export function normalizeSelectorNamePayload(payload, context = null) {
    const requested = new Set((context?.unknownSelectors || [])
        .map(entry => normalizeSelectorId(entry?.selector || entry))
        .filter(Boolean));
    const values = Array.isArray(payload?.names)
        ? payload.names
        : (Array.isArray(payload) ? payload : []);

    const seen = new Set();
    return values.map(entry => {
        const selector = normalizeSelectorId(entry?.selector);
        const heuristicName = normalizeHeuristicName(entry?.heuristicName || entry?.heuristic_name || entry?.name);
        if (!selector || !heuristicName || seen.has(selector)) return null;
        if (requested.size && !requested.has(selector)) return null;
        seen.add(selector);
        const confidence = ['high', 'medium', 'low'].includes(String(entry?.confidence || '').toLowerCase())
            ? String(entry.confidence).toLowerCase()
            : 'low';
        return {
            selector,
            heuristicName,
            confidence,
            reasoning: String(entry?.reasoning || entry?.reason || '').trim().slice(0, 500),
        };
    }).filter(Boolean).slice(0, 80);
}

export function assessSelectorNameQuality(names, context = null) {
    const requestedCount = Array.isArray(context?.unknownSelectors) ? context.unknownSelectors.length : 0;
    const selectorContexts = unknownSelectorContextBySelector(context);
    const nameCounts = new Map();
    const generic = [];
    const invalidSemantics = [];
    for (const entry of names || []) {
        const key = String(entry?.heuristicName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key) continue;
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
        if (GENERIC_HEURISTIC_NAMES.has(key)) generic.push(entry.heuristicName);
        const semanticReason = assessSelectorNameSemantics(entry, selectorContexts.get(entry.selector));
        if (semanticReason) invalidSemantics.push({
            selector: entry.selector,
            heuristicName: entry.heuristicName,
            reason: semanticReason,
        });
    }
    const duplicates = [...nameCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name, count]) => ({ name, count }));
    const tooSparse = requestedCount > 0 && names.length < requestedCount;
    return {
        ok: duplicates.length === 0 && generic.length === 0 && invalidSemantics.length === 0 && !tooSparse,
        duplicates,
        generic: [...new Set(generic)],
        invalidSemantics,
        tooSparse,
    };
}

export function makeSelectorNamesUnique(names) {
    const counts = new Map();
    return (names || []).map(entry => {
        const key = String(entry?.heuristicName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const count = counts.get(key) || 0;
        counts.set(key, count + 1);
        if (!key || count === 0) return entry;
        const suffix = String(entry.selector || '').replace(/^0x/i, '').slice(0, 4).toUpperCase();
        return {
            ...entry,
            heuristicName: normalizeHeuristicName(`${entry.heuristicName}${suffix}`) || entry.heuristicName,
            reasoning: entry.reasoning
                ? `${entry.reasoning} Distinct selector suffix added because the model repeated a heuristic name.`
                : 'Distinct selector suffix added because the model repeated a heuristic name.',
        };
    });
}

function requestedSelectorIds(context = null) {
    const seen = new Set();
    return (context?.unknownSelectors || [])
        .map(entry => normalizeSelectorId(entry?.selector || entry))
        .filter(selector => {
            if (!selector || seen.has(selector)) return false;
            seen.add(selector);
            return true;
        });
}

export function acceptableSelectorNames(names, context = null) {
    const selectorContexts = unknownSelectorContextBySelector(context);
    return (names || []).filter(entry => {
        const key = String(entry?.heuristicName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return key
            && !GENERIC_HEURISTIC_NAMES.has(key)
            && !assessSelectorNameSemantics(entry, selectorContexts.get(entry.selector));
    });
}

export function missingSelectorIds(names, context = null) {
    const named = new Set((names || []).map(entry => normalizeSelectorId(entry?.selector)).filter(Boolean));
    return requestedSelectorIds(context).filter(selector => !named.has(selector));
}

export function buildSelectorNameRetryContext(context = null, selectors = []) {
    const selectorSet = new Set((selectors || []).map(normalizeSelectorId).filter(Boolean));
    const unknownSelectors = (context?.unknownSelectors || [])
        .filter(entry => selectorSet.has(normalizeSelectorId(entry?.selector || entry)));
    return {
        ...context,
        unknownSelectors,
        unknownSelectorTable: unknownSelectors
            .map(record => `${normalizeSelectorId(record?.selector || record)} ${record?.args || '()'} ${record?.mutability || ''} Unknown`)
            .join('\n'),
    };
}

function makeFallbackSelectorName(selectorContext, usedNameKeys = new Set()) {
    const selector = normalizeSelectorId(selectorContext?.selector || selectorContext);
    if (!selector) return null;
    const suffix = selector.replace(/^0x/i, '').slice(-6).toUpperCase();
    const mutability = String(selectorContext?.mutability || '').toLowerCase();
    const args = String(selectorContext?.args || '').trim();
    const inputCount = Array.isArray(selectorContext?.inputTypes)
        ? selectorContext.inputTypes.length
        : (args && args !== '()' ? 1 : 0);
    let baseName;

    if (mutability === 'pure' && inputCount === 0) {
        baseName = `constantSelector${suffix}`;
    } else if ((mutability === 'view' || mutability === 'pure') && inputCount === 0) {
        baseName = `selector${suffix}Value`;
    } else if (mutability === 'view' || mutability === 'pure') {
        baseName = `selector${suffix}Lookup`;
    } else {
        baseName = `selector${suffix}Action`;
    }

    let heuristicName = normalizeHeuristicName(baseName);
    let counter = 2;
    while (heuristicName && usedNameKeys.has(heuristicName.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        heuristicName = normalizeHeuristicName(`${baseName}${counter}`);
        counter += 1;
    }
    if (!heuristicName) return null;
    usedNameKeys.add(heuristicName.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return {
        selector,
        heuristicName,
        confidence: 'low',
        reasoning: 'Fallback label added because selector naming did not return an accepted name for this selector.',
        source: 'fallback',
    };
}

export function fillMissingSelectorNames(names, context = null) {
    const selectorContexts = unknownSelectorContextBySelector(context);
    const usedNameKeys = new Set((names || [])
        .map(entry => String(entry?.heuristicName || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter(Boolean));
    const fallbackNames = missingSelectorIds(names, context)
        .map(selector => makeFallbackSelectorName(selectorContexts.get(selector) || { selector }, usedNameKeys))
        .filter(Boolean);
    return [...(names || []), ...fallbackNames];
}

async function fetchCodexSelectorNames(credentials, context, { fastMode = false, reasoningEffort = 'low' } = {}) {
    const startedAt = Date.now();
    const contextBytes = new TextEncoder().encode(JSON.stringify(context || {})).byteLength;
    const maxAttempts = 2;
    let nextContext = context;
    let retryFeedback = '';
    const acceptedBySelector = new Map();
    let lastQuality = null;
    let lastTiming = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CODEX_TIMEOUT_MS);
        const body = JSON.stringify(buildCodexSelectorNamesRequestBody(nextContext, {
            fastMode,
            reasoningEffort,
            retryFeedback,
        }));
        const requestBodyBytes = new TextEncoder().encode(body).byteLength;

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
                throw new Error(`Codex selector naming failed with HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 240)}` : ''}`);
            }

            const { text: contentText, timing: sseTiming } = await readCodexSseText(response, controller.signal, { startedAt });
            console.log('Codex selector names raw content:', contentText);
            const jsonText = extractJsonText(contentText);
            if (!jsonText) {
                throw new Error(`Codex returned empty selector-name output: ${summarizeRawOutputForError(contentText) || 'empty output'}`);
            }

            let parsed;
            try {
                parsed = JSON.parse(jsonText);
            } catch (error) {
                throw new Error(`Codex returned malformed selector-name JSON: ${summarizeRawOutputForError(contentText) || error?.message || 'parse failed'}`);
            }

            const names = normalizeSelectorNamePayload(parsed, nextContext);
            const quality = assessSelectorNameQuality(names, nextContext);
            const acceptedNames = makeSelectorNamesUnique(acceptableSelectorNames(names, nextContext));
            acceptedNames.forEach(entry => acceptedBySelector.set(entry.selector, entry));
            lastQuality = quality;
            lastTiming = {
                totalMs: Date.now() - startedAt,
                requestBodyBytes,
                contextBytes,
                responseHeadersMs,
                responseHeaders: responseHeaderDiagnostics,
                outputChars: contentText.length,
                fastMode: !!fastMode,
                reasoningEffort: normalizeCodexReasoningEffort(reasoningEffort),
                attempt: attempt + 1,
                quality,
                ...sseTiming,
            };

            const missingSelectors = missingSelectorIds([...acceptedBySelector.values()], context);
            if (missingSelectors.length === 0 || attempt === maxAttempts - 1) break;

            nextContext = buildSelectorNameRetryContext(context, missingSelectors);
            retryFeedback = [
                'The previous output omitted or used rejected names for some selectors. Return one selector-specific name for every selector in this smaller unknownSelectors list.',
                quality.invalidSemantics?.length
                    ? `Invalid mutability/name matches: ${quality.invalidSemantics.map(item => `${item.selector} ${item.heuristicName} (${item.reason})`).join('; ')}.`
                    : '',
                quality.generic?.length
                    ? `Generic names: ${quality.generic.join(', ')}.`
                    : '',
                `Still missing selectors: ${missingSelectors.join(', ')}.`,
            ].filter(Boolean).join(' ');
            console.warn('Codex selector names missing or rejected entries, retrying subset:', {
                quality,
                missingSelectors,
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error(`Codex selector naming timed out after ${CODEX_TIMEOUT_MS / 1000}s`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    try {
        const acceptedNames = fillMissingSelectorNames(
            makeSelectorNamesUnique([...acceptedBySelector.values()]),
            context
        );
        const timing = {
            totalMs: Date.now() - startedAt,
            contextBytes,
            fastMode: !!fastMode,
            reasoningEffort: normalizeCodexReasoningEffort(reasoningEffort),
            finalQuality: lastQuality,
            ...(lastTiming || {}),
        };
        console.info('Codex selector naming timing:', timing);

        return {
            ok: true,
            model: fastMode ? CODEX_PRIORITY_MODEL_LABEL : CODEX_MODEL,
            promptVersion: SELECTOR_NAME_PROMPT_VERSION,
            names: acceptedNames,
            usage: null,
            timing,
        };
    } catch (error) {
        throw error;
    }
}

export async function handleCodexSelectorNames(message, sendResponse) {
    const context = message?.context;
    if (!context || typeof context !== 'object') {
        sendResponse({ ok: false, error: 'Missing selector naming context.' });
        return;
    }

    const dedupeKey = getDedupeKey(message);

    try {
        const selectorNamesPromise = getBackgroundDedupePromise(
            selectorNamesInFlight,
            selectorNamesRecentResults,
            dedupeKey,
            async () => {
                const credentials = await getValidCodexCredentials();
                return fetchCodexSelectorNames(credentials, context, {
                    fastMode: !!message?.fastMode,
                    reasoningEffort: normalizeCodexReasoningEffort(message?.reasoningEffort),
                });
            }
        );
        sendResponse(await selectorNamesPromise);
    } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
    }
}
