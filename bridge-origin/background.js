const BRIDGE_ORIGIN_LOOKUP_TYPE = 'EVMOLE_BRIDGE_ORIGIN_LOOKUP';
const BRIDGE_FETCH_ENDPOINT = 'https://bridge-fetchagg.vercel.app/api/transaction-hash';
const BRIDGE_FETCH_TIMEOUT_MS = 6500;
const OPENROUTER_SUMMARY_TYPE = 'EVMOLE_OPENROUTER_SUMMARY';
const OPENROUTER_STATUS_TYPE = 'EVMOLE_OPENROUTER_STATUS';
const OPENROUTER_CHAT_TYPE = 'EVMOLE_OPENROUTER_CHAT';
const CODEX_SUMMARY_TYPE = 'EVMOLE_CODEX_SUMMARY';
const CODEX_SELECTOR_NAMES_TYPE = 'EVMOLE_CODEX_SELECTOR_NAMES';
const CODEX_CHAT_TYPE = 'EVMOLE_CODEX_CHAT';
const CODEX_STATUS_TYPE = 'EVMOLE_CODEX_STATUS';
const CODEX_LOGIN_TYPE = 'EVMOLE_CODEX_LOGIN';
const CODEX_LOGOUT_TYPE = 'EVMOLE_CODEX_LOGOUT';
const FETCH_TOKEN_URI_TYPE = 'EVMOLE_FETCH_TOKEN_URI';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';
const OPENROUTER_TIMEOUT_MS = 45000;
const OPENROUTER_SUMMARY_ATTEMPT_TIMEOUT_MS = 20000;
const CODEX_MODEL = 'gpt-5.5';
const CODEX_PRIORITY_MODEL_LABEL = 'gpt-5.5:priority';
const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const CODEX_TIMEOUT_MS = 90000;
const CODEX_STORAGE_KEY = 'evmoleCodexCredentials';
const CODEX_PENDING_STORAGE_KEY = 'evmoleCodexPendingLogin';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_DEVICE_USER_CODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const CODEX_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_DEVICE_VERIFICATION_URI = 'https://auth.openai.com/codex/device';
const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const CODEX_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const TOKEN_URI_FETCH_TIMEOUT_MS = 8500;
const TOKEN_URI_MAX_BYTES = 1024 * 1024;
const SUMMARY_PROMPT_VERSION = 'evmole-contract-summary-v19-token-limit-facts';
const SELECTOR_NAME_PROMPT_VERSION = 'evmole-selector-heuristic-v3';
const SUMMARY_SYSTEM_PROMPT = `You are Evmole's concise EVM contract analyst. Use only the supplied evidence. Do not invent behavior from function names alone. Prioritize interpreted facts and numbers first: contribution amounts, max raise, min/max buys, taxes/fees, timestamps, cooldowns, bonding-curve parameters, routers/pairs, and privileged roles. Convert wei/token units and epoch timestamps when direct evidence supports the conversion. For token amounts, never assume decimals: only convert raw token integers when a decimals() read result is present in the evidence. Keep prose short and put explanations after facts. Never claim safety or give investment advice. Return only valid json.`;
const CHAT_SYSTEM_PROMPT = 'You are Evmole contract chat. Answer questions about the current EVM contract using only the supplied evidence, toolContext, relatedContracts, mentionedContracts, and prior chat. Be concise. If mentionedContracts are provided, compare the explicitly mentioned contracts to the current contract even when creator/deployer evidence differs or is missing. If relatedContracts are provided, compare only the supplied contracts and explain how they may fit together from creator, summaries, facts, function counts, and explicit evidence; do not infer integration beyond evidence. If toolContext contains contract_function_calls, treat read calls as current eth_call results and simulated calls as non-persistent eth_call simulations: no transaction was signed, no wallet executed anything, and no state changed. Use simulation reverts/errors as evidence of the current call path only, not proof that a future signed transaction must fail. If toolContext contains NFT metadata, image, SVG, or JSON, summarize the fetched facts directly without naming internal read functions unless the user asks. If evidence is missing, ask for the missing value plainly. Do not claim safety or give investment advice.';
const SELECTOR_NAME_SYSTEM_PROMPT = `You name unknown EVM function selectors for UI context. Use only the supplied bytecode and selector metadata. Return provisional heuristic names, not real ABI claims. Never imply a generated name is verified. Return only valid json.`;
const BACKGROUND_RESULT_TTL_MS = 5 * 60 * 1000;
const openRouterSummaryInFlight = new Map();
const openRouterSummaryRecentResults = new Map();
const codexSummaryInFlight = new Map();
const codexSummaryRecentResults = new Map();
const selectorNamesInFlight = new Map();
const selectorNamesRecentResults = new Map();
const SUMMARY_USER_PROMPT_PREFIX = `Analyze this EVM contract from the supplied evidence.

Required JSON shape:
{
  "facts": [
    { "label": "Max raise", "value": "30 ETH", "source": "maxRaiseWeth()" },
    { "label": "Per contributor", "value": "1 ETH", "source": "contributionAmount()" }
  ],
  "contract_creator": { "address": "0x6D7265FbC9eb8D99bded6f9037339Ae644641a1C", "label": "Contract creator", "source": "explorer" },
  "summary": "1 short sentence explaining what the contract appears to do.",
  "contract_type": "erc20_token|erc721_nft|token|router|factory|proxy|vault|nft|governance|uniswap_v4_hook|unknown|other",
  "confidence": "high|medium|low",
  "key_behaviors": ["up to 2 concise interpreted behaviors"],
  "implementation_uniqueness": ["up to 3 concise points explaining what is custom, different, or distinctive about this implementation"],
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
- Keep output compact: at most 4 facts, 2 key behaviors, 3 implementation_uniqueness points, and 2 read_context entries.
- Put concrete facts in "facts" first. Use short labels like "Per contributor", "Max contributors", "Sale window", "Buy tax", "Sell tax", "Cooldown", "Router", "Pair", "Bonding curve".
- Prefer evidence.functionSurface over raw selector counts. Infer purpose from grouped standard/custom reads, custom writes, parameter shapes, mutability, and meaningHint fields.
- If evidence.functionSurface.heuristicUnknowns exists, treat those names as provisional AI-generated hints only, not verified ABI names.
- evidence.materialReadValues is intentionally selective. Use those values for concrete addresses, limits, fees, supplies, pool configuration, or state only when present; do not require read values to infer broad purpose from function names and parameters.
- If evidence.localSummaryBaseline exists, preserve its token identity, supply, and creator facts unless later evidence contradicts them.
- If evidence.erc20EnrichmentFocus exists, this is an ERC-20 token that already has local baseline facts. Focus the summary, key_behaviors, and implementation_uniqueness on uncommon/custom functions and how they could affect use in a theorized scenario, using cautious language such as "suggests", "appears", or "could". Do not merely restate the standard ERC-20 surface.
- If evidence includes contractCreator, copy its address exactly into "contract_creator.address". Do not infer a creator if it is missing.
- If evidence includes contractIdentifiers, use those deterministic identifiers to distinguish protocol roles. For id "erc20_token", set contract_type to "erc20_token". For id "erc721_nft", set contract_type to "erc721_nft"; setApprovalForAll(address,bool) is a strong ERC-721/NFT signal. For id "uniswap_v4_hook", set contract_type to "uniswap_v4_hook" only when matched hook/base-hook selector evidence is present; hook address bits alone are only clarification.
- For Uniswap v4 hooks, assume the reader already knows what a hook address is. Do not explain generic hook mechanics or enumerate every callback. Interpret what this specific hook appears to implement: leverage loops, LP engine behavior, debt/health/liquidation mechanics, position receipts, fee/insurance economics, pool/reserve accounting, seed liquidity, or custom constraints.
- Do not put raw hook flags or getHookPermissions booleans in facts. Use them only to support usecase interpretation.
- If implementationDifferences.interpretedUsecase exists, use it as high-priority evidence for summary, key_behaviors, and implementation_uniqueness.
- If evidence includes implementationDifferences, fill implementation_uniqueness with what makes this implementation different from a generic protocol/base contract: interpreted callbacks, custom selectors, swap/liquidity behavior, risk/control selectors, or unknown selectors. Do not imply uniqueness beyond the provided evidence.
- For ERC-20 facts, combine token name and symbol into one fact value like "Echo (ECHO)". If totalSupply and maxSupply are identical after decimals conversion, return one combined supply fact instead of two.
- Do not write raw variable-style explanations when a converted interpretation is possible. Prefer "1 ETH per contributor" over "contributionAmount is 1000000000000000000".
- For ERC-20-style token amounts such as maxSupply, totalSupply, totalMinted, maxWallet, or maxTx, cite decimals() when converting. If decimals() is missing or failed, show the raw integer and say decimals are unknown.
- Never write "likely 18", "probably 18", or any guessed decimals value.
- Include raw function names only in "source" or read_context.
- If a number is inferred from multiple reads, state the interpreted result and cite the sources.

Evidence JSON:`;

function getDedupeKey(message) {
    return typeof message?.dedupeKey === 'string' ? message.dedupeKey.slice(0, 4000) : '';
}

function getRecentBackgroundResult(resultMap, dedupeKey) {
    if (!dedupeKey) return null;
    const entry = resultMap.get(dedupeKey);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > BACKGROUND_RESULT_TTL_MS) {
        resultMap.delete(dedupeKey);
        return null;
    }
    return entry.value;
}

function rememberBackgroundResult(resultMap, dedupeKey, value) {
    if (!dedupeKey || !value?.ok) return;
    resultMap.set(dedupeKey, { value, storedAt: Date.now() });
    if (resultMap.size <= 50) return;
    const oldestKey = resultMap.keys().next().value;
    if (oldestKey) resultMap.delete(oldestKey);
}

function getBackgroundDedupePromise(inFlightMap, recentResultMap, dedupeKey, createPromise) {
    const recentResult = getRecentBackgroundResult(recentResultMap, dedupeKey);
    if (recentResult) return Promise.resolve(recentResult);
    if (!dedupeKey) return createPromise();

    let promise = inFlightMap.get(dedupeKey);
    if (!promise) {
        promise = Promise.resolve().then(createPromise);
        inFlightMap.set(dedupeKey, promise);
        promise.then(
            result => {
                inFlightMap.delete(dedupeKey);
                rememberBackgroundResult(recentResultMap, dedupeKey, result);
            },
            () => inFlightMap.delete(dedupeKey)
        );
    }
    return promise;
}

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

function localStorageGet(defaults) {
    return new Promise(resolve => {
        if (!chrome.storage?.local) {
            resolve({ ...defaults });
            return;
        }

        chrome.storage.local.get(defaults, settings => {
            if (chrome.runtime.lastError) {
                resolve({ ...defaults });
                return;
            }
            resolve(settings || { ...defaults });
        });
    });
}

function localStorageSet(values) {
    return new Promise((resolve, reject) => {
        if (!chrome.storage?.local) {
            resolve();
            return;
        }

        chrome.storage.local.set(values, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message || 'Could not save local settings.'));
                return;
            }
            resolve();
        });
    });
}

function localStorageRemove(keys) {
    return new Promise((resolve, reject) => {
        if (!chrome.storage?.local) {
            resolve();
            return;
        }

        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message || 'Could not clear local settings.'));
                return;
            }
            resolve();
        });
    });
}

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

async function clearCodexCredentials() {
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

async function getValidCodexCredentials() {
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

async function getCodexStatus() {
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

async function startCodexLogin() {
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

function normalizeSummaryPayload(payload, context = null) {
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

function normalizeSelectorId(value) {
    const selector = String(value || '').trim().toLowerCase();
    return /^0x[0-9a-f]{8}$/.test(selector) ? selector : '';
}

function normalizeHeuristicName(value) {
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

function unknownSelectorContextBySelector(context = null) {
    return new Map((context?.unknownSelectors || [])
        .map(entry => [normalizeSelectorId(entry?.selector), entry])
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
    return '';
}

function normalizeSelectorNamePayload(payload, context = null) {
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

function assessSelectorNameQuality(names, context = null) {
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
    const tooSparse = requestedCount > 0 && names.length < Math.min(requestedCount, 8);
    return {
        ok: duplicates.length === 0 && generic.length === 0 && invalidSemantics.length === 0 && !tooSparse,
        duplicates,
        generic: [...new Set(generic)],
        invalidSemantics,
        tooSparse,
    };
}

function makeSelectorNamesUnique(names) {
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

function normalizeCodexReasoningEffort(value) {
    return ['low', 'medium', 'high'].includes(value) ? value : 'low';
}

function buildCodexSummaryRequestBody(context, { fastMode = false, reasoningEffort = 'low' } = {}) {
    const body = {
        model: CODEX_MODEL,
        store: false,
        stream: true,
        instructions: SUMMARY_SYSTEM_PROMPT,
        input: [
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: `${SUMMARY_USER_PROMPT_PREFIX}\n${JSON.stringify(context)}\n\nReturn only the raw json object.`
                    }
                ]
            }
        ],
        reasoning: { effort: normalizeCodexReasoningEffort(reasoningEffort) },
        text: { verbosity: 'low' },
    };

    if (fastMode) {
        body.service_tier = 'priority';
    }

    return body;
}

function buildCodexSelectorNamesRequestBody(context, { fastMode = false, reasoningEffort = 'low', retryFeedback = '' } = {}) {
    const body = {
        model: CODEX_MODEL,
        store: false,
        stream: true,
        instructions: SELECTOR_NAME_SYSTEM_PROMPT,
        input: [
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: [
                            'Based on this bytecode, help the UI understand what these unknown function signatures could be used for. Create a simple heuristic function name for each selector that gives better context for how it is used in this contract.',
                            'Return only this JSON shape: {"names":[{"selector":"0x12345678","heuristicName":"shortCamelCaseName","confidence":"high|medium|low","reasoning":"brief bytecode/selector evidence"}]}.',
                            'Rules:',
                            '- Do not include parameters in heuristicName.',
                            '- Treat context.knownFunctionTable and context.knownFunctionNames as high-priority vocabulary for the contract domain. Use those declared/resolved names to infer whether unknown selectors are launch, tax, fee, hook, treasury, migration, pool, token, owner/admin, wallet, or phase related.',
                            '- Keep mutability honest: pure/view functions are reads or computations, not updates. A pure no-arg selector should almost always be named as a specific constant, such as constantMaxLaunchWindow or constantBaseFeeBps.',
                            '- Every selector must get a distinct heuristicName unless the bytecode clearly routes two selectors to the exact same handler; if so use an Alias suffix, such as constantSwapFeeShareAlias.',
                            '- Avoid generic placeholders: readConstant, readStoredValue, readAddressValue, readIndexedConfig, readObservation, readConfigTuple, readFlag, computeScaledValue, unknownAction.',
                            '- For pure no-arg functions, infer the specific constant purpose where possible, for example constantMaxTaxBps, constantDecayDuration, constantHookFlagMask, constantCooldownBlocks.',
                            '- For view no-arg functions, infer the storage/config purpose where possible, for example launchConfig, tokenAddress, treasuryAddress, launchStartBlock, totalCollectedFees.',
                            '- For address and uint256 parameters, name the mapping/calculation purpose, for example userLastTradeBlock, addressFeeDebt, feeTierAt, taxAtElapsed, buyPhaseAt, sellPhaseAt.',
                            '- Use domain nouns from bytecode evidence and neighboring selectors: launch, fee, tax, hook, treasury, migration, block, phase, cooldown, liquidity, wallet, token, config.',
                            '- Do not output names for selectors not listed in unknownSelectors.',
                            '- Do not claim the names are verified or declared source names.',
                            '- Prefer low confidence when evidence is mostly selector shape, mutability, or neighboring functions.',
                            retryFeedback ? `Previous output was rejected: ${retryFeedback}` : '',
                            `Context JSON:\n${JSON.stringify(context)}`,
                        ].filter(Boolean).join('\n')
                    }
                ]
            }
        ],
        reasoning: { effort: normalizeCodexReasoningEffort(reasoningEffort) },
        text: { verbosity: 'low' },
    };

    if (fastMode) {
        body.service_tier = 'priority';
    }

    return body;
}

function buildCodexChatRequestBody({ question, context, history, fastMode = false, reasoningEffort = 'low' } = {}) {
    const body = {
        model: CODEX_MODEL,
        store: false,
        stream: true,
        instructions: CHAT_SYSTEM_PROMPT,
        input: [
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: [
                            `Contract evidence JSON:\n${JSON.stringify(context)}`,
                            `Prior chat JSON:\n${JSON.stringify((history || []).map(entry => ({
                                role: entry.role === 'assistant' ? 'assistant' : 'user',
                                content: String(entry.content || '').slice(0, 2000)
                            })))}`,
                            `Question:\n${question}`
                        ].join('\n\n')
                    }
                ]
            }
        ],
        reasoning: { effort: normalizeCodexReasoningEffort(reasoningEffort) },
        text: { verbosity: 'low' },
    };

    if (fastMode) {
        body.service_tier = 'priority';
    }

    return body;
}

function extractCodexResponseText(response) {
    const parts = [];
    const visit = value => {
        if (!value) return;
        if (typeof value === 'string') return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value !== 'object') return;

        if ((value.type === 'output_text' || value.type === 'text') && typeof value.text === 'string') {
            parts.push(value.text);
        }
        if (typeof value.output_text === 'string') {
            parts.push(value.output_text);
        }
        if (value.content) visit(value.content);
        if (value.output) visit(value.output);
    };
    visit(response);
    return parts.join('');
}

async function readCodexSseText(response, signal, { startedAt = Date.now() } = {}) {
    if (!response.body) throw new Error('Codex returned no response body.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outputText = '';
    let finalResponseText = '';
    const timing = {
        firstEventMs: null,
        firstChunkMs: null,
        lastEventMs: null,
        responseCreatedMs: null,
        responseInProgressMs: null,
        firstReasoningEventMs: null,
        firstOutputItemMs: null,
        firstContentPartMs: null,
        firstOutputDeltaMs: null,
        completedEventMs: null,
        responseStatus: '',
        responseModel: '',
        responseId: '',
        incompleteReason: '',
        eventCounts: {},
        eventTimeline: [],
    };

    const markEvent = type => {
        const elapsedMs = Date.now() - startedAt;
        if (timing.firstEventMs === null) timing.firstEventMs = elapsedMs;
        timing.lastEventMs = elapsedMs;
        if (type && timing.eventTimeline.length < 24) {
            timing.eventTimeline.push({ type, elapsedMs });
        }
        return elapsedMs;
    };

    const handleEvent = rawEvent => {
        const dataLines = rawEvent
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart());
        if (dataLines.length === 0) return;

        const data = dataLines.join('\n').trim();
        if (!data || data === '[DONE]') return;

        let event;
        try {
            event = JSON.parse(data);
        } catch {
            return;
        }

        const type = String(event.type || '');
        const eventMs = markEvent(type);
        if (type) {
            timing.eventCounts[type] = (timing.eventCounts[type] || 0) + 1;
        }
        if (type === 'response.created' && timing.responseCreatedMs === null) timing.responseCreatedMs = eventMs;
        if (type === 'response.in_progress' && timing.responseInProgressMs === null) timing.responseInProgressMs = eventMs;
        if (type.includes('reasoning') && timing.firstReasoningEventMs === null) timing.firstReasoningEventMs = eventMs;
        if ((type === 'response.output_item.added' || type === 'response.output_item.done') && timing.firstOutputItemMs === null) timing.firstOutputItemMs = eventMs;
        if ((type === 'response.content_part.added' || type === 'response.content_part.done') && timing.firstContentPartMs === null) timing.firstContentPartMs = eventMs;
        if (event.response) {
            timing.responseStatus = event.response.status || timing.responseStatus;
            timing.responseModel = event.response.model || timing.responseModel;
            timing.responseId = event.response.id || timing.responseId;
            timing.incompleteReason = event.response.incomplete_details?.reason || timing.incompleteReason;
        }
        if (type === 'response.failed') {
            const error = event.response?.error || event.error || {};
            throw new Error(error.message || error.code || 'Codex response failed.');
        }
        if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
            if (timing.firstOutputDeltaMs === null) timing.firstOutputDeltaMs = Date.now() - startedAt;
            outputText += event.delta;
            return;
        }
        if ((type === 'response.completed' || type === 'response.done' || type === 'response.incomplete') && event.response) {
            timing.completedEventMs = Date.now() - startedAt;
            finalResponseText = extractCodexResponseText(event.response) || finalResponseText;
        }
    };

    while (true) {
        if (signal?.aborted) throw new Error('Codex summary request was aborted.');
        const { value, done } = await reader.read();
        if (done) break;
        if (timing.firstChunkMs === null) timing.firstChunkMs = Date.now() - startedAt;

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            handleEvent(rawEvent);
        }
    }

    buffer += decoder.decode();
    if (buffer.trim()) handleEvent(buffer);
    return {
        text: (outputText || finalResponseText).trim(),
        timing,
    };
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

async function handleCodexSummary(message, sendResponse) {
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

async function fetchCodexSelectorNames(credentials, context, { fastMode = false, reasoningEffort = 'low' } = {}) {
    const startedAt = Date.now();
    const contextBytes = new TextEncoder().encode(JSON.stringify(context || {})).byteLength;
    const attempts = [
        { retryFeedback: '' },
        { retryFeedback: 'Names were too generic or duplicated. Produce selector-specific, distinct names using bytecode/storage/constant evidence. Do not use readConstant/readStoredValue/readAddressValue/readIndexedConfig-style placeholders.' },
    ];
    let lastQuality = null;
    let lastNames = [];
    let lastTiming = null;

    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CODEX_TIMEOUT_MS);
        const body = JSON.stringify(buildCodexSelectorNamesRequestBody(context, {
            fastMode,
            reasoningEffort,
            retryFeedback: attempts[attempt].retryFeedback,
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

            const names = normalizeSelectorNamePayload(parsed, context);
            const quality = assessSelectorNameQuality(names, context);
            lastNames = names;
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

            if (quality.ok || attempt === attempts.length - 1) break;
            attempts[attempt + 1].retryFeedback = [
                attempts[attempt + 1].retryFeedback,
                quality.invalidSemantics?.length
                    ? `Invalid mutability/name matches: ${quality.invalidSemantics.map(item => `${item.selector} ${item.heuristicName} (${item.reason})`).join('; ')}.`
                    : '',
                quality.duplicates?.length
                    ? `Duplicate names: ${quality.duplicates.map(item => `${item.name} x${item.count}`).join(', ')}.`
                    : '',
                quality.generic?.length
                    ? `Generic names: ${quality.generic.join(', ')}.`
                    : '',
            ].filter(Boolean).join(' ');
            console.warn('Codex selector names rejected for quality, retrying:', quality);
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
        const selectorContexts = unknownSelectorContextBySelector(context);
        const acceptedNames = makeSelectorNamesUnique((lastNames || []).filter(entry => {
            const key = String(entry?.heuristicName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return key
                && !GENERIC_HEURISTIC_NAMES.has(key)
                && !assessSelectorNameSemantics(entry, selectorContexts.get(entry.selector));
        }));
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

async function handleCodexSelectorNames(message, sendResponse) {
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

async function handleCodexChat(message, sendResponse) {
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

    if (message?.type === CODEX_STATUS_TYPE) {
        getCodexStatus()
            .then(status => sendResponse(status))
            .catch(error => sendResponse({ ok: false, status: 'error', error: error?.message || String(error) }));
        return true;
    }

    if (message?.type === CODEX_LOGIN_TYPE) {
        startCodexLogin()
            .then(status => sendResponse(status))
            .catch(error => sendResponse({ ok: false, status: 'error', error: error?.message || String(error) }));
        return true;
    }

    if (message?.type === CODEX_LOGOUT_TYPE) {
        clearCodexCredentials()
            .then(() => sendResponse({ ok: true, status: 'logged_out' }))
            .catch(error => sendResponse({ ok: false, status: 'error', error: error?.message || String(error) }));
        return true;
    }

    if (message?.type === OPENROUTER_SUMMARY_TYPE) {
        handleOpenRouterSummary(message, sendResponse);
        return true;
    }

    if (message?.type === CODEX_SUMMARY_TYPE) {
        handleCodexSummary(message, sendResponse);
        return true;
    }

    if (message?.type === CODEX_SELECTOR_NAMES_TYPE) {
        handleCodexSelectorNames(message, sendResponse);
        return true;
    }

    if (message?.type === OPENROUTER_CHAT_TYPE) {
        handleOpenRouterChat(message, sendResponse);
        return true;
    }

    if (message?.type === CODEX_CHAT_TYPE) {
        handleCodexChat(message, sendResponse);
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
