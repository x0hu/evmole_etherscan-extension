import {
    CHAT_SYSTEM_PROMPT,
    CODEX_ENDPOINT,
    CODEX_MODEL,
    CODEX_PRIORITY_MODEL_LABEL,
    CODEX_TIMEOUT_MS,
    OPENROUTER_ENDPOINT,
    OPENROUTER_MODEL,
    OPENROUTER_TIMEOUT_MS,
} from './constants.js';
import { getValidCodexCredentials } from './codex-auth.js';
import {
    buildCodexChatRequestBody,
    getMessageContentText,
    normalizeCodexReasoningEffort,
    readCodexSseText,
} from './codex-client.js';
import { getOpenRouterApiKey } from './storage.js';

export async function handleOpenRouterChat(message, sendResponse) {
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
                        content: CHAT_SYSTEM_PROMPT
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

async function fetchCodexChat(credentials, { question, context, history, fastMode = false, reasoningEffort = 'low' } = {}) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CODEX_TIMEOUT_MS);
    const body = JSON.stringify(buildCodexChatRequestBody({ question, context, history, fastMode, reasoningEffort }));
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
            throw new Error(`Codex chat failed with HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 240)}` : ''}`);
        }

        const { text: answer, timing: sseTiming } = await readCodexSseText(response, controller.signal, { startedAt });
        if (!answer) throw new Error('Codex returned an empty chat response.');

        const timing = {
            totalMs: Date.now() - startedAt,
            requestBodyBytes,
            contextBytes,
            responseHeadersMs,
            responseHeaders: responseHeaderDiagnostics,
            outputChars: answer.length,
            fastMode: !!fastMode,
            reasoningEffort: normalizeCodexReasoningEffort(reasoningEffort),
            ...sseTiming,
        };

        return {
            ok: true,
            answer,
            model: fastMode ? CODEX_PRIORITY_MODEL_LABEL : CODEX_MODEL,
            usage: null,
            timing,
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`Codex chat timed out after ${CODEX_TIMEOUT_MS / 1000}s`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export async function handleCodexChat(message, sendResponse) {
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

    try {
        const credentials = await getValidCodexCredentials();
        sendResponse(await fetchCodexChat(credentials, {
            question,
            context,
            history,
            fastMode: !!message?.fastMode,
            reasoningEffort: normalizeCodexReasoningEffort(message?.reasoningEffort),
        }));
    } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
    }
}
