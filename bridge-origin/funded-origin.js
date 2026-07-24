(function() {
    'use strict';

    const LOOKUP_MESSAGE_TYPE = 'EVMOLE_BRIDGE_ORIGIN_LOOKUP';
    const RH_SCAN_HOSTNAME = 'rh-scan.xyz';
    const RH_SCAN_LOOKUP_CLASS = 'evmole-rh-scan-bridge-origin-lookup';
    const lookupCache = new Map();

    function extractTxHashFromHref(href) {
        try {
            const url = new URL(href, window.location.origin);
            const match = url.pathname.match(/^\/tx\/(0x[a-fA-F0-9]{64})$/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    function shortenAddress(address) {
        const value = String(address || '');
        if (value.length <= 14) return value;
        return `${value.slice(0, 10)}...${value.slice(-4)}`;
    }

    function normalizeHash(hash) {
        return String(hash || '').trim().toLowerCase();
    }

    function getBridgeSide(match, names) {
        for (const name of names) {
            const side = match?.[name];
            if (!side) continue;
            return typeof side === 'string' ? { address: side } : side;
        }
        return null;
    }

    function sendBridgeLookupMessage(txHash) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
                reject(new Error('Extension messaging is unavailable'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Bridge lookup timed out'));
            }, 20000);

            chrome.runtime.sendMessage({ type: LOOKUP_MESSAGE_TYPE, txHash }, response => {
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

    function lookupBridgeOrigin(txHash) {
        const key = normalizeHash(txHash);
        if (!lookupCache.has(key)) {
            const request = sendBridgeLookupMessage(txHash).catch(error => {
                lookupCache.delete(key);
                throw error;
            });
            lookupCache.set(key, request);
        }
        return lookupCache.get(key);
    }

    function pickOrigin(data, txHash) {
        const matches = Array.isArray(data?.matches) ? data.matches : [];
        const normalizedTxHash = normalizeHash(txHash);
        const exactMatch = matches.find(match => {
            const sender = getBridgeSide(match, ['sender', 'from', 'source', 'origin']);
            const receiver = getBridgeSide(match, ['receiver', 'to', 'destination']);
            const senderTxHash = normalizeHash(sender?.txHash);
            const receiverTxHash = normalizeHash(receiver?.txHash);
            return senderTxHash === normalizedTxHash || receiverTxHash === normalizedTxHash;
        });
        const match = exactMatch || matches[0];
        const sender = getBridgeSide(match, ['sender', 'from', 'source', 'origin']);
        const receiver = getBridgeSide(match, ['receiver', 'to', 'destination']);
        const senderTxHash = normalizeHash(sender?.txHash);
        const origin = senderTxHash === normalizedTxHash && receiver?.address
            ? receiver
            : sender;

        if (!origin?.address) return null;

        return {
            provider: match?.provider || 'bridge',
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
        return `${window.location.origin}/address/${origin.address}`;
    }

    function findTxLinkForCopyButton(copyButton) {
        let sibling = copyButton.previousElementSibling;
        while (sibling) {
            if (sibling.matches?.('a[href*="/tx/"]')) {
                const txHash = extractTxHashFromHref(sibling.href);
                if (txHash) return { txLink: sibling, txHash };
            }
            sibling = sibling.previousElementSibling;
        }
        return null;
    }

    function hasLookupButtonForTx(container, txHash) {
        return Boolean(container.querySelector(`.evmole-bridge-origin-lookup[data-tx-hash="${txHash.toLowerCase()}"]`));
    }

    function createRhScanLookupIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.display = 'block';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M6 19c0-3 2-5 5-5h2c3 0 5-2 5-5M6 19l3-3M6 19l3 3M18 9l-3-3M18 9l-3 3');
        svg.appendChild(path);
        return svg;
    }

    function isRhScanLookupButton(button) {
        return button.classList.contains(RH_SCAN_LOOKUP_CLASS);
    }

    function setButtonIcon(button, className) {
        button.replaceChildren();

        if (isRhScanLookupButton(button)) {
            button.appendChild(createRhScanLookupIcon());
            const label = document.createElement('span');
            label.textContent = className.includes('spinner')
                ? 'Finding...'
                : className.includes('exclamation')
                    ? 'Try Again'
                    : 'Bridge Origin';
            button.appendChild(label);
            return;
        }

        const icon = document.createElement('i');
        icon.className = className;
        button.appendChild(icon);
    }

    function setLookupError(button, message) {
        button.dataset.lookupState = 'error';
        button.href = '#';
        button.removeAttribute('target');
        button.removeAttribute('rel');
        button.setAttribute('title', message);
        button.setAttribute('aria-label', message);
        setButtonIcon(button, 'fas fa-exclamation-circle fa-fw');

        setTimeout(() => {
            if (button.dataset.lookupState !== 'error') return;
            button.dataset.lookupState = 'idle';
            button.setAttribute('title', 'Find Bridge Origin Address');
            button.setAttribute('aria-label', 'Find Bridge Origin Address');
            setButtonIcon(button, 'fas fa-route fa-fw');
        }, 2500);
    }

    function setResolvedOrigin(button, origin) {
        const chainLabel = origin.chainName || origin.chainId || 'unknown chain';
        const providerLabel = origin.provider ? `${origin.provider} bridge origin` : 'Bridge origin';
        const label = shortenAddress(origin.address);
        const span = document.createElement('span');
        span.className = 'd-block text-truncate';
        span.style.maxWidth = '7rem';
        span.textContent = label;

        button.dataset.lookupState = 'resolved';
        button.href = getExplorerUrl(origin);
        button.target = '_blank';
        button.rel = 'noopener noreferrer';
        button.classList.remove('link-secondary');
        button.classList.add('link-primary');
        button.setAttribute('title', `${providerLabel} on ${chainLabel}: ${origin.address}`);
        button.setAttribute('aria-label', `${providerLabel} ${label}`);
        button.replaceChildren(span);
    }

    function createLookupButton(txHash, variant = 'etherscan') {
        const button = document.createElement('a');
        button.href = '#';
        if (variant === 'rh-scan') {
            button.className = `iconbtn evmole-bridge-origin-lookup ${RH_SCAN_LOOKUP_CLASS}`;
            button.style.height = '25px';
            button.style.padding = '0 7px';
            button.style.gap = '5px';
            button.style.fontSize = '11.5px';
        } else {
            button.className = 'js-bridge-origin link-secondary evmole-bridge-origin-lookup d-inline-flex align-items-center';
        }
        button.dataset.txHash = txHash.toLowerCase();
        button.dataset.lookupState = 'idle';
        button.setAttribute('data-bs-toggle', 'tooltip');
        button.setAttribute('data-bs-trigger', 'hover');
        button.setAttribute('title', 'Find Bridge Origin Address');
        button.setAttribute('aria-label', 'Find Bridge Origin Address');
        setButtonIcon(button, 'fas fa-route fa-fw');

        button.addEventListener('click', async event => {
            if (button.dataset.lookupState === 'resolved') return;

            event.preventDefault();
            event.stopPropagation();

            if (button.dataset.lookupState === 'loading') return;

            button.dataset.lookupState = 'loading';
            button.setAttribute('title', 'Finding bridge origin...');
            button.setAttribute('aria-label', 'Finding bridge origin');
            setButtonIcon(button, 'fas fa-spinner fa-spin fa-fw');

            try {
                const data = await lookupBridgeOrigin(txHash);
                const origin = pickOrigin(data, txHash);
                if (!origin) {
                    setLookupError(button, 'No bridge origin found for this transaction hash');
                    return;
                }
                setResolvedOrigin(button, origin);
            } catch (error) {
                setLookupError(button, error?.message || 'Bridge lookup failed');
            }
        });

        return button;
    }

    function addRhScanBridgeOriginLookupButton() {
        if (window.location.hostname !== RH_SCAN_HOSTNAME) return false;

        const fundedHeader = Array.from(document.querySelectorAll('.thead'))
            .find(element => String(element.textContent || '').trim().toLowerCase() === 'funded by');
        const fundedRow = fundedHeader?.nextElementSibling;
        const fundedContent = fundedRow?.firstElementChild;
        const txLink = Array.from(fundedContent?.querySelectorAll('a[href*="/tx/"]') || [])
            .find(link => extractTxHashFromHref(link.href));
        const txHash = txLink ? extractTxHashFromHref(txLink.href) : null;

        if (!fundedContent || !txLink || !txHash || hasLookupButtonForTx(fundedContent, txHash)) {
            return false;
        }

        txLink.insertAdjacentElement('afterend', createLookupButton(txHash, 'rh-scan'));
        return true;
    }

    function addBridgeOriginLookupButtons() {
        let added = addRhScanBridgeOriginLookupButton();
        const copyButtons = document.querySelectorAll('a.evmole-funded-tx-copy');

        copyButtons.forEach(copyButton => {
            const txContext = findTxLinkForCopyButton(copyButton);
            if (!txContext) return;

            const container = copyButton.parentElement || document;
            if (hasLookupButtonForTx(container, txContext.txHash)) return;

            copyButton.insertAdjacentElement('beforebegin', createLookupButton(txContext.txHash));
            added = true;
        });

        return added;
    }

    function retryBridgeOriginLookupButtons() {
        if (addBridgeOriginLookupButtons()) return;

        let attempts = 0;
        const maxAttempts = 50;
        const interval = setInterval(() => {
            if (addBridgeOriginLookupButtons() || ++attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 100);
    }

    retryBridgeOriginLookupButtons();

    const observer = new MutationObserver(() => {
        addBridgeOriginLookupButtons();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
