import {
    CODEX_CLIENT_ID,
    CODEX_DEVICE_REDIRECT_URI,
    CODEX_DEVICE_TOKEN_URL,
    CODEX_DEVICE_USER_CODE_URL,
    CODEX_DEVICE_VERIFICATION_URI,
    CODEX_PENDING_STORAGE_KEY,
    CODEX_STORAGE_KEY,
    CODEX_TOKEN_REFRESH_SKEW_MS,
    CODEX_TOKEN_URL,
} from './constants.js';
import { localStorageGet, localStorageRemove, localStorageSet } from './storage.js';

function decodeJwtPayload(token) {
    try {
        const payload = String(token || '').split('.')[1] || '';
        if (!payload) return null;
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

function getCodexAccountId(accessToken) {
    const payload = decodeJwtPayload(accessToken);
    const accountId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId ? accountId : '';
}

function normalizeCodexCredentials(raw) {
    const credentials = raw && typeof raw === 'object' ? raw : {};
    const access = String(credentials.access || '').trim();
    const refresh = String(credentials.refresh || '').trim();
    const expires = Number(credentials.expires || 0);
    const accountId = String(credentials.accountId || '').trim() || getCodexAccountId(access);
    if (!access || !refresh || !Number.isFinite(expires) || expires <= 0 || !accountId) return null;
    return { access, refresh, expires, accountId };
}

async function getCodexCredentials() {
    const settings = await localStorageGet({ [CODEX_STORAGE_KEY]: null });
    return normalizeCodexCredentials(settings[CODEX_STORAGE_KEY]);
}

async function saveCodexCredentials(credentials) {
    await localStorageSet({ [CODEX_STORAGE_KEY]: credentials });
}

export async function clearCodexCredentials() {
    await localStorageRemove([CODEX_STORAGE_KEY, CODEX_PENDING_STORAGE_KEY]);
}

function credentialsStatus(credentials) {
    if (!credentials) return 'logged_out';
    return credentials.expires <= Date.now() ? 'expired' : 'logged_in';
}

async function exchangeCodexAuthorizationCode(code, verifier, redirectUri) {
    const response = await fetch(CODEX_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CODEX_CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
        }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(`Codex token exchange failed (${response.status}): ${payload?.error_description || payload?.error || response.statusText}`);
    }

    const access = String(payload?.access_token || '');
    const refresh = String(payload?.refresh_token || '');
    const expiresIn = Number(payload?.expires_in || 0);
    const accountId = getCodexAccountId(access);
    if (!access || !refresh || !Number.isFinite(expiresIn) || expiresIn <= 0 || !accountId) {
        throw new Error('Codex token exchange response was missing required fields.');
    }

    return {
        access,
        refresh,
        expires: Date.now() + expiresIn * 1000,
        accountId,
    };
}

async function refreshCodexCredentials(credentials) {
    const response = await fetch(CODEX_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: credentials.refresh,
            client_id: CODEX_CLIENT_ID,
        }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(`Codex token refresh failed (${response.status}): ${payload?.error_description || payload?.error || response.statusText}`);
    }

    const access = String(payload?.access_token || '');
    const refresh = String(payload?.refresh_token || credentials.refresh);
    const expiresIn = Number(payload?.expires_in || 0);
    const accountId = getCodexAccountId(access);
    if (!access || !refresh || !Number.isFinite(expiresIn) || expiresIn <= 0 || !accountId) {
        throw new Error('Codex token refresh response was missing required fields.');
    }

    const next = {
        access,
        refresh,
        expires: Date.now() + expiresIn * 1000,
        accountId,
    };
    await saveCodexCredentials(next);
    return next;
}

export async function getValidCodexCredentials() {
    const credentials = await getCodexCredentials();
    if (!credentials) {
        throw new Error('Login to Codex in the Evmole popup first.');
    }

    if (credentials.expires - Date.now() > CODEX_TOKEN_REFRESH_SKEW_MS) {
        return credentials;
    }

    try {
        return await refreshCodexCredentials(credentials);
    } catch (error) {
        await clearCodexCredentials();
        throw error;
    }
}

export async function getCodexStatus() {
    const credentials = await getCodexCredentials();
    const pending = (await localStorageGet({ [CODEX_PENDING_STORAGE_KEY]: null }))[CODEX_PENDING_STORAGE_KEY];
    if (pending?.userCode && pending?.expiresAt && Number(pending.expiresAt) > Date.now() && !credentials) {
        if (!codexLoginPollPromise && pending.deviceAuthId) {
            codexLoginPollPromise = pollCodexDeviceLogin(pending)
                .catch(error => {
                    console.warn('Codex login polling failed:', error?.message || error);
                })
                .finally(() => {
                    codexLoginPollPromise = null;
                });
        }
        return {
            ok: true,
            status: 'pending',
            userCode: pending.userCode,
            verificationUri: pending.verificationUri || CODEX_DEVICE_VERIFICATION_URI,
            expiresAt: pending.expiresAt,
            intervalSeconds: pending.intervalSeconds || 5,
        };
    }

    return {
        ok: true,
        status: credentialsStatus(credentials),
        accountId: credentials?.accountId || '',
        expires: credentials?.expires || 0,
    };
}

let codexLoginPollPromise = null;

async function pollCodexDeviceLogin(device) {
    const startedAt = Date.now();
    const expiresAt = Number(device.expiresAt || startedAt + 15 * 60 * 1000);
    let intervalMs = Math.max(1000, Number(device.intervalSeconds || 5) * 1000);

    while (Date.now() < expiresAt) {
        const currentPending = (await localStorageGet({ [CODEX_PENDING_STORAGE_KEY]: null }))[CODEX_PENDING_STORAGE_KEY];
        if (currentPending?.deviceAuthId !== device.deviceAuthId) {
            throw new Error('Codex login cancelled.');
        }

        const response = await fetch(CODEX_DEVICE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_auth_id: device.deviceAuthId,
                user_code: device.userCode,
            }),
        });

        if (response.ok) {
            const payload = await response.json();
            const authorizationCode = payload?.authorization_code;
            const codeVerifier = payload?.code_verifier;
            if (!authorizationCode || !codeVerifier) {
                throw new Error('Invalid Codex device authorization response.');
            }
            const latestPending = (await localStorageGet({ [CODEX_PENDING_STORAGE_KEY]: null }))[CODEX_PENDING_STORAGE_KEY];
            if (latestPending?.deviceAuthId !== device.deviceAuthId) {
                throw new Error('Codex login cancelled.');
            }
            const credentials = await exchangeCodexAuthorizationCode(authorizationCode, codeVerifier, CODEX_DEVICE_REDIRECT_URI);
            await saveCodexCredentials(credentials);
            await localStorageRemove(CODEX_PENDING_STORAGE_KEY);
            return credentials;
        }

        const text = await response.text().catch(() => '');
        let errorCode = '';
        try {
            const payload = JSON.parse(text);
            const error = payload?.error;
            errorCode = typeof error === 'object' ? error?.code : error;
        } catch {}

        if (response.status === 403 || response.status === 404 || errorCode === 'deviceauth_authorization_pending') {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            continue;
        }

        if (errorCode === 'slow_down') {
            intervalMs += 5000;
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            continue;
        }

        throw new Error(`Codex device authorization failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`);
    }

    await localStorageRemove(CODEX_PENDING_STORAGE_KEY);
    throw new Error('Codex login expired before authorization completed.');
}

export async function startCodexLogin() {
    const response = await fetch(CODEX_DEVICE_USER_CODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(`Codex device login failed (${response.status}): ${payload?.error_description || payload?.error || response.statusText}`);
    }

    const deviceAuthId = String(payload?.device_auth_id || '');
    const userCode = String(payload?.user_code || '');
    const intervalSeconds = Number(payload?.interval || 5);
    if (!deviceAuthId || !userCode || !Number.isFinite(intervalSeconds)) {
        throw new Error('Invalid Codex device login response.');
    }

    const pending = {
        deviceAuthId,
        userCode,
        intervalSeconds,
        verificationUri: CODEX_DEVICE_VERIFICATION_URI,
        expiresAt: Date.now() + 15 * 60 * 1000,
    };
    await localStorageSet({ [CODEX_PENDING_STORAGE_KEY]: pending });

    if (!codexLoginPollPromise) {
        codexLoginPollPromise = pollCodexDeviceLogin(pending)
            .catch(error => {
                console.warn('Codex login polling failed:', error?.message || error);
            })
            .finally(() => {
                codexLoginPollPromise = null;
            });
    }

    return { ok: true, status: 'pending', ...pending };
}
