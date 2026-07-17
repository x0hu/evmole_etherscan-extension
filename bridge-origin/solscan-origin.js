(function() {
    'use strict';

    const LOOKUP_MESSAGE_TYPE = 'EVMOLE_BRIDGE_ORIGIN_LOOKUP';
    const PREWARM_BODY_CLASS = 'evmole-solscan-bridge-origin-prewarming';
    const PREWARM_STYLE_ID = 'evmole-solscan-bridge-origin-prewarm-style';
    const SOLANA_TRANSACTION_SIGNATURE_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{80,100}\b/;
    const lookupCache = new Map();
    const lookupInputCache = new WeakMap();
    let scanScheduled = false;

    function getAccountAddress() {
        return window.location.pathname.split('/account/')[1]?.split(/[?#]/)[0] || '';
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    function shortenAddress(address) {
        const value = String(address || '');
        if (value.length <= 14) return value;
        return `${value.slice(0, 8)}...${value.slice(-6)}`;
    }

    function sendBridgeLookupMessage(lookupInput) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
                reject(new Error('Extension messaging is unavailable'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Bridge lookup timed out'));
            }, 20000);

            chrome.runtime.sendMessage({ type: LOOKUP_MESSAGE_TYPE, txHash: lookupInput }, response => {
                clearTimeout(timeout);

                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message));
                    return;
                }

                if (!response?.ok) {
                    reject(new Error(response?.error || 'Bridge lookup failed'));
                    return;
                }

                resolve(response.data);
            });
        });
    }

    function lookupBridgeOrigin(lookupInput) {
        const key = normalize(lookupInput);
        if (!lookupCache.has(key)) {
            const request = sendBridgeLookupMessage(lookupInput).catch(error => {
                lookupCache.delete(key);
                throw error;
            });
            lookupCache.set(key, request);
        }
        return lookupCache.get(key);
    }

    function extractTransactionHash(value) {
        const text = String(value || '');
        const pathMatch = text.match(/\/tx\/([^/?#\s]+)/i);
        if (pathMatch?.[1]) return pathMatch[1];

        return text.match(SOLANA_TRANSACTION_SIGNATURE_PATTERN)?.[0] || '';
    }

    function collectElementLookupStrings(element) {
        if (!element) return [];

        const strings = [];
        const push = value => {
            if (value) strings.push(String(value));
        };
        const elements = [element, ...element.querySelectorAll('*')];

        for (const node of elements) {
            push(node.textContent);
            push(node.getAttribute?.('href'));
            push(node.getAttribute?.('title'));
            push(node.getAttribute?.('aria-label'));
            push(node.getAttribute?.('data-href'));
            push(node.getAttribute?.('data-value'));
            push(node.getAttribute?.('data-tooltip-content'));

            for (const value of Object.values(node.dataset || {})) {
                push(value);
            }
        }

        return strings;
    }

    function findTransactionHashInElement(element) {
        for (const value of collectElementLookupStrings(element)) {
            const hash = extractTransactionHash(value);
            if (hash) return hash;
        }
        return '';
    }

    function getBridgeLookupInput(targetWrapper, accountAddress) {
        const row = targetWrapper?.parentElement;
        return findTransactionHashInElement(row) ||
            findTransactionHashInElement(targetWrapper) ||
            '';
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function ensurePrewarmStyle() {
        if (document.getElementById(PREWARM_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = PREWARM_STYLE_ID;
        style.textContent = `
            body.${PREWARM_BODY_CLASS} [role="dialog"],
            body.${PREWARM_BODY_CLASS} [data-radix-popper-content-wrapper] {
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;
        document.documentElement.appendChild(style);
    }

    function findBridgeLookupInputInOpenDialog() {
        const dialog = document.querySelector('[role="dialog"]') ||
            Array.from(document.querySelectorAll('div')).find(element =>
                (element.textContent || '').includes('At TxHash:')
            );
        return findTransactionHashInElement(dialog);
    }

    async function findBridgeLookupInputFromFundedDialog(targetWrapper) {
        const existingDialogHash = findBridgeLookupInputInOpenDialog();
        if (existingDialogHash) return existingDialogHash;

        const fundedButton = targetWrapper?.querySelector?.('button[aria-haspopup="dialog"], button.w-full');
        if (!fundedButton) return '';

        ensurePrewarmStyle();
        document.body.classList.add(PREWARM_BODY_CLASS);

        try {
            fundedButton.click();

            for (let attempt = 0; attempt < 40; attempt += 1) {
                await delay(50);

                const dialogHash = findBridgeLookupInputInOpenDialog();
                if (dialogHash) {
                    fundedButton.click();
                    return dialogHash;
                }
            }

            fundedButton.click();
            return '';
        } finally {
            document.body.classList.remove(PREWARM_BODY_CLASS);
        }
    }

    async function resolveBridgeLookupInput(targetWrapper, accountAddress) {
        let request = lookupInputCache.get(targetWrapper);
        if (!request) {
            request = Promise.resolve()
                .then(() => getBridgeLookupInput(targetWrapper, accountAddress) ||
                    findBridgeLookupInputFromFundedDialog(targetWrapper))
                .catch(error => {
                    lookupInputCache.delete(targetWrapper);
                    throw error;
                });
            lookupInputCache.set(targetWrapper, request);
        }

        const lookupInput = await request;
        if (!lookupInput) lookupInputCache.delete(targetWrapper);
        return lookupInput;
    }

    function prewarmBridgeLookupInput(targetWrapper, accountAddress) {
        resolveBridgeLookupInput(targetWrapper, accountAddress)
            .then(lookupInput => {
                if (lookupInput) lookupBridgeOrigin(lookupInput).catch(() => {});
            })
            .catch(() => {});
    }

    function schedulePrewarmBridgeLookupInput(targetWrapper, accountAddress) {
        const schedule = window.requestIdleCallback || (callback => setTimeout(callback, 750));
        schedule(() => {
            if (!document.body.contains(targetWrapper)) return;
            prewarmBridgeLookupInput(targetWrapper, accountAddress);
        }, { timeout: 2500 });
    }

    function matchReferencesLookup(match, lookupInput) {
        const normalizedLookup = normalize(lookupInput);
        return normalize(match?.sender?.txHash) === normalizedLookup ||
            normalize(match?.receiver?.txHash) === normalizedLookup;
    }

    function pickCounterparty(match, accountAddress) {
        const normalizedAccount = normalize(accountAddress);
        const sender = match?.sender;
        const receiver = match?.receiver;
        const senderIsAccount = normalize(sender?.address) === normalizedAccount;
        const receiverIsAccount = normalize(receiver?.address) === normalizedAccount;

        if (receiverIsAccount && sender?.address) return sender;
        if (senderIsAccount && receiver?.address) return receiver;
        if (sender?.address && !senderIsAccount) return sender;
        if (receiver?.address && !receiverIsAccount) return receiver;
        return sender?.address ? sender : receiver;
    }

    function pickOrigin(data, accountAddress, lookupInput) {
        const matches = Array.isArray(data?.matches) ? data.matches : [];
        const normalizedAccount = normalize(accountAddress);
        const match = matches.find(item =>
            normalize(item?.receiver?.address) === normalizedAccount &&
            matchReferencesLookup(item, lookupInput)
        ) ||
            matches.find(item => normalize(item?.receiver?.address) === normalizedAccount) ||
            matches.find(item =>
                normalize(item?.sender?.address) === normalizedAccount &&
                matchReferencesLookup(item, lookupInput)
            ) ||
            matches.find(item => normalize(item?.sender?.address) === normalizedAccount) ||
            matches.find(item => matchReferencesLookup(item, lookupInput)) ||
            matches[0];

        if (!match) return null;

        const origin = pickCounterparty(match, accountAddress);

        if (!origin?.address) return null;

        return {
            provider: match.provider || 'bridge',
            address: origin.address,
            chainId: origin.chainId,
            chainName: origin.chainName,
        };
    }

    function getExplorerUrl(origin) {
        const explorers = window.EvmoleBridgeOriginExplorers;
        const chainIdOrName = origin.chainId || origin.chainName;
        if (explorers?.getExplorerUrl && chainIdOrName) {
            return explorers.getExplorerUrl(chainIdOrName, origin.address);
        }
        return `https://etherscan.io/address/${origin.address}`;
    }

    function findSolscanCellWrapper(element) {
        let current = element;
        for (let depth = 0; current && depth < 8; depth += 1) {
            if (
                current.tagName === 'DIV' &&
                current.classList?.contains('box-border') &&
                current.classList?.contains('relative') &&
                current.classList?.contains('px-1')
            ) {
                return current;
            }
            current = current.parentElement;
        }
        return element?.parentElement || null;
    }

    function findFundedByValueWrappers() {
        const wrappers = new Set();
        const labels = document.querySelectorAll('div');

        for (const label of labels) {
            if ((label.textContent || '').trim() !== 'Funded by') continue;

            const labelWrapper = findSolscanCellWrapper(label);
            const row = labelWrapper?.parentElement;
            if (!row) continue;

            const valueWrapper = Array.from(row.children).find(child =>
                child !== labelWrapper &&
                child.querySelector?.('button[aria-haspopup="dialog"], button.w-full')
            );

            if (valueWrapper) wrappers.add(valueWrapper);
        }

        return Array.from(wrappers);
    }

    function setButtonState(button, state, label) {
        button.dataset.lookupState = state;
        button.textContent = label;
    }

    function showError(wrapper, message) {
        const result = wrapper.querySelector('.evmole-solscan-bridge-origin-result');
        result.replaceChildren();
        result.textContent = message;
        result.style.color = '#dc2626';
    }

    function showOrigin(wrapper, origin) {
        const result = wrapper.querySelector('.evmole-solscan-bridge-origin-result');
        const chainLabel = origin.chainName || origin.chainId || 'unknown chain';
        const link = document.createElement('a');
        link.href = getExplorerUrl(origin);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = shortenAddress(origin.address);
        link.title = `${origin.provider} bridge origin on ${chainLabel}: ${origin.address}`;
        link.style.color = '#2563eb';
        link.style.display = 'block';
        link.style.minWidth = '0';
        link.style.overflow = 'hidden';
        link.style.textDecoration = 'none';
        link.style.textOverflow = 'ellipsis';
        link.style.fontWeight = '500';
        link.style.whiteSpace = 'nowrap';

        result.replaceChildren(link);
        result.style.color = '';
    }

    function applyHostLayout(targetWrapper) {
        targetWrapper.classList.add('evmole-solscan-bridge-origin-host');
        targetWrapper.style.alignItems = 'stretch';
        targetWrapper.style.display = 'flex';
        targetWrapper.style.flexDirection = 'column';
        targetWrapper.style.gap = '6px';
    }

    function createOriginControl(accountAddress, targetWrapper) {
        const wrapper = document.createElement('div');
        wrapper.className = 'evmole-solscan-bridge-origin';
        wrapper.dataset.accountAddress = accountAddress;
        wrapper.style.alignItems = 'center';
        wrapper.style.boxSizing = 'border-box';
        wrapper.style.display = 'flex';
        wrapper.style.gap = '8px';
        wrapper.style.margin = '0';
        wrapper.style.maxWidth = '100%';
        wrapper.style.minWidth = '0';
        wrapper.style.padding = '0';
        wrapper.style.width = '100%';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'evmole-solscan-bridge-origin-button';
        button.dataset.lookupState = 'idle';
        button.setAttribute('aria-label', 'Fetch bridge origin');
        button.style.alignItems = 'center';
        button.style.background = 'var(--color-neutral0, #fff)';
        button.style.border = '1px solid var(--color-neutral4, #d4d4d8)';
        button.style.borderRadius = '6px';
        button.style.boxSizing = 'border-box';
        button.style.color = 'inherit';
        button.style.cursor = 'pointer';
        button.style.display = 'inline-flex';
        button.style.flex = '0 0 96px';
        button.style.fontSize = '12px';
        button.style.fontWeight = '500';
        button.style.height = '24px';
        button.style.justifyContent = 'center';
        button.style.lineHeight = '24px';
        button.style.padding = '0 8px';
        button.style.minWidth = '96px';
        button.style.whiteSpace = 'nowrap';
        button.style.width = '96px';
        setButtonState(button, 'idle', 'Origin');
        button.addEventListener('pointerenter', () => {
            prewarmBridgeLookupInput(targetWrapper, accountAddress);
        });
        button.addEventListener('focus', () => {
            prewarmBridgeLookupInput(targetWrapper, accountAddress);
        });
        button.addEventListener('touchstart', () => {
            prewarmBridgeLookupInput(targetWrapper, accountAddress);
        }, { passive: true });

        const result = document.createElement('div');
        result.className = 'evmole-solscan-bridge-origin-result';
        result.style.alignItems = 'center';
        result.style.display = 'flex';
        result.style.flex = '1 1 auto';
        result.style.fontSize = '12px';
        result.style.lineHeight = '24px';
        result.style.marginTop = '0';
        result.style.minHeight = '24px';
        result.style.minWidth = '0';
        result.style.overflow = 'hidden';
        result.style.textOverflow = 'ellipsis';
        result.style.whiteSpace = 'nowrap';

        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();

            if (button.dataset.lookupState === 'loading') return;

            setButtonState(button, 'loading', 'Loading...');

            try {
                const lookupInput = await resolveBridgeLookupInput(targetWrapper, accountAddress);
                if (!lookupInput) {
                    showError(wrapper, 'No tx hash');
                    setButtonState(button, 'idle', 'Origin');
                    return;
                }

                wrapper.dataset.lookupInput = lookupInput;
                const data = await lookupBridgeOrigin(lookupInput);
                const origin = pickOrigin(data, accountAddress, lookupInput);
                if (!origin) {
                    showError(wrapper, 'No origin');
                    setButtonState(button, 'idle', 'Origin');
                    return;
                }

                showOrigin(wrapper, origin);
                setButtonState(button, 'resolved', 'Origin');
            } catch (error) {
                showError(wrapper, error?.message || 'Bridge lookup failed');
                setButtonState(button, 'idle', 'Origin');
            }
        });

        wrapper.append(button, result);
        schedulePrewarmBridgeLookupInput(targetWrapper, accountAddress);
        return wrapper;
    }

    function addBridgeOriginControlToWrapper(targetWrapper, accountAddress) {
        const legacySiblingControl = targetWrapper.nextElementSibling?.classList?.contains('evmole-solscan-bridge-origin')
            ? targetWrapper.nextElementSibling
            : null;
        legacySiblingControl?.remove();

        applyHostLayout(targetWrapper);

        const existingControl = targetWrapper.querySelector(':scope > .evmole-solscan-bridge-origin');
        if (existingControl?.dataset.accountAddress === accountAddress) {
            return false;
        }
        existingControl?.remove();

        targetWrapper.appendChild(createOriginControl(accountAddress, targetWrapper));
        return true;
    }

    function addBridgeOriginControls() {
        const accountAddress = getAccountAddress();
        if (!accountAddress) return false;
        if (document.querySelector(`.evmole-solscan-bridge-origin[data-account-address="${accountAddress}"]`)) {
            return false;
        }

        const targetWrappers = findFundedByValueWrappers();
        if (!targetWrappers.length) return false;

        return targetWrappers
            .map(targetWrapper => addBridgeOriginControlToWrapper(targetWrapper, accountAddress))
            .some(Boolean);
    }

    function scheduleBridgeOriginControls() {
        if (scanScheduled) return;

        scanScheduled = true;
        setTimeout(() => {
            scanScheduled = false;
            addBridgeOriginControls();
        }, 100);
    }

    function retryBridgeOriginControl() {
        if (addBridgeOriginControls()) return;

        let attempts = 0;
        const maxAttempts = 80;
        const interval = setInterval(() => {
            if (addBridgeOriginControls() || ++attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 250);
    }

    retryBridgeOriginControl();

    const observer = new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.addedNodes.length || mutation.removedNodes.length)) return;
        scheduleBridgeOriginControls();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
