export const BRIDGE_ORIGIN_LOOKUP_TYPE = 'EVMOLE_BRIDGE_ORIGIN_LOOKUP';
export const BRIDGE_FETCH_ENDPOINT = 'https://bridge-fetchagg.vercel.app/api/transaction-hash';
export const BRIDGE_FETCH_TIMEOUT_MS = 6500;
export const OPENROUTER_SUMMARY_TYPE = 'EVMOLE_OPENROUTER_SUMMARY';
export const OPENROUTER_STATUS_TYPE = 'EVMOLE_OPENROUTER_STATUS';
export const OPENROUTER_CHAT_TYPE = 'EVMOLE_OPENROUTER_CHAT';
export const CODEX_SUMMARY_TYPE = 'EVMOLE_CODEX_SUMMARY';
export const CODEX_SELECTOR_NAMES_TYPE = 'EVMOLE_CODEX_SELECTOR_NAMES';
export const CODEX_CHAT_TYPE = 'EVMOLE_CODEX_CHAT';
export const CODEX_STATUS_TYPE = 'EVMOLE_CODEX_STATUS';
export const CODEX_LOGIN_TYPE = 'EVMOLE_CODEX_LOGIN';
export const CODEX_LOGOUT_TYPE = 'EVMOLE_CODEX_LOGOUT';
export const FETCH_TOKEN_URI_TYPE = 'EVMOLE_FETCH_TOKEN_URI';
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';
export const OPENROUTER_TIMEOUT_MS = 45000;
export const OPENROUTER_SUMMARY_ATTEMPT_TIMEOUT_MS = 20000;
export const CODEX_MODEL = 'gpt-5.5';
export const CODEX_PRIORITY_MODEL_LABEL = 'gpt-5.5:priority';
export const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const CODEX_TIMEOUT_MS = 90000;
export const CODEX_STORAGE_KEY = 'evmoleCodexCredentials';
export const CODEX_PENDING_STORAGE_KEY = 'evmoleCodexPendingLogin';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_DEVICE_USER_CODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
export const CODEX_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_DEVICE_VERIFICATION_URI = 'https://auth.openai.com/codex/device';
export const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
export const CODEX_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
export const TOKEN_URI_FETCH_TIMEOUT_MS = 8500;
export const TOKEN_URI_MAX_BYTES = 1024 * 1024;
export const SUMMARY_PROMPT_VERSION = 'evmole-contract-summary-v19-token-limit-facts';
export const SELECTOR_NAME_PROMPT_VERSION = 'evmole-selector-heuristic-v3';
export const SUMMARY_SYSTEM_PROMPT = `You are Evmole's concise EVM contract analyst. Use only the supplied evidence. Do not invent behavior from function names alone. Prioritize interpreted facts and numbers first: contribution amounts, max raise, min/max buys, taxes/fees, timestamps, cooldowns, bonding-curve parameters, routers/pairs, and privileged roles. Convert wei/token units and epoch timestamps when direct evidence supports the conversion. For token amounts, never assume decimals: only convert raw token integers when a decimals() read result is present in the evidence. Keep prose short and put explanations after facts. Never claim safety or give investment advice. Return only valid json.`;
export const CHAT_SYSTEM_PROMPT = 'You are Evmole contract chat. Answer questions about the current EVM contract using only the supplied evidence, toolContext, relatedContracts, mentionedContracts, and prior chat. Be concise. If mentionedContracts are provided, compare the explicitly mentioned contracts to the current contract even when creator/deployer evidence differs or is missing. If relatedContracts are provided, compare only the supplied contracts and explain how they may fit together from creator, summaries, facts, function counts, and explicit evidence; do not infer integration beyond evidence. If toolContext contains contract_function_calls, treat read calls as current eth_call results and simulated calls as non-persistent eth_call simulations: no transaction was signed, no wallet executed anything, and no state changed. Use simulation reverts/errors as evidence of the current call path only, not proof that a future signed transaction must fail. If toolContext contains NFT metadata, image, SVG, or JSON, summarize the fetched facts directly without naming internal read functions unless the user asks. If evidence is missing, ask for the missing value plainly. Do not claim safety or give investment advice.';
export const SELECTOR_NAME_SYSTEM_PROMPT = `You name unknown EVM function selectors for UI context. Use only the supplied bytecode and selector metadata. Return provisional heuristic names, not real ABI claims. Never imply a generated name is verified. Return only valid json.`;
export const BACKGROUND_RESULT_TTL_MS = 5 * 60 * 1000;
export const SUMMARY_USER_PROMPT_PREFIX = `Analyze this EVM contract from the supplied evidence.

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
