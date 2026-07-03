import {
    BRIDGE_ORIGIN_LOOKUP_TYPE,
    CODEX_CHAT_TYPE,
    CODEX_LOGIN_TYPE,
    CODEX_LOGOUT_TYPE,
    CODEX_SELECTOR_NAMES_TYPE,
    CODEX_STATUS_TYPE,
    CODEX_SUMMARY_TYPE,
    FETCH_TOKEN_URI_TYPE,
    OPENROUTER_CHAT_TYPE,
    OPENROUTER_STATUS_TYPE,
    OPENROUTER_SUMMARY_TYPE,
} from './background/constants.js';
import { clearCodexCredentials, getCodexStatus, startCodexLogin } from './background/codex-auth.js';
import { handleCodexChat, handleOpenRouterChat } from './background/chat.js';
import { handleBridgeOriginLookup, handleFetchTokenUri } from './background/fetch-tools.js';
import { handleCodexSelectorNames } from './background/selector-names.js';
import { handleCodexSummary, handleOpenRouterSummary } from './background/summaries.js';
import { getOpenRouterApiKey } from './background/storage.js';

export function createMessageRouter(handlers) {
    return (message, _sender, sendResponse) => {
        if (message?.type === OPENROUTER_STATUS_TYPE) {
            handlers.getOpenRouterApiKey()
                .then(apiKey => sendResponse({ ok: true, hasKey: !!apiKey }))
                .catch(error => sendResponse({ ok: false, hasKey: false, error: error?.message || String(error) }));
            return true;
        }

        if (message?.type === CODEX_STATUS_TYPE) {
            handlers.getCodexStatus()
                .then(status => sendResponse(status))
                .catch(error => sendResponse({ ok: false, status: 'error', error: error?.message || String(error) }));
            return true;
        }

        if (message?.type === CODEX_LOGIN_TYPE) {
            handlers.startCodexLogin()
                .then(status => sendResponse(status))
                .catch(error => sendResponse({ ok: false, status: 'error', error: error?.message || String(error) }));
            return true;
        }

        if (message?.type === CODEX_LOGOUT_TYPE) {
            handlers.clearCodexCredentials()
                .then(() => sendResponse({ ok: true, status: 'logged_out' }))
                .catch(error => sendResponse({ ok: false, status: 'error', error: error?.message || String(error) }));
            return true;
        }

        if (message?.type === OPENROUTER_SUMMARY_TYPE) {
            handlers.handleOpenRouterSummary(message, sendResponse);
            return true;
        }

        if (message?.type === CODEX_SUMMARY_TYPE) {
            handlers.handleCodexSummary(message, sendResponse);
            return true;
        }

        if (message?.type === CODEX_SELECTOR_NAMES_TYPE) {
            handlers.handleCodexSelectorNames(message, sendResponse);
            return true;
        }

        if (message?.type === OPENROUTER_CHAT_TYPE) {
            handlers.handleOpenRouterChat(message, sendResponse);
            return true;
        }

        if (message?.type === CODEX_CHAT_TYPE) {
            handlers.handleCodexChat(message, sendResponse);
            return true;
        }

        if (message?.type === FETCH_TOKEN_URI_TYPE) {
            handlers.handleFetchTokenUri(message, sendResponse);
            return true;
        }

        if (!message || message.type !== BRIDGE_ORIGIN_LOOKUP_TYPE) {
            return false;
        }

        return handlers.handleBridgeOriginLookup(message, sendResponse);
    };
}

const handlers = {
    clearCodexCredentials,
    getCodexStatus,
    getOpenRouterApiKey,
    handleBridgeOriginLookup,
    handleCodexChat,
    handleCodexSelectorNames,
    handleCodexSummary,
    handleFetchTokenUri,
    handleOpenRouterChat,
    handleOpenRouterSummary,
    startCodexLogin,
};

if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(createMessageRouter(handlers));
}
