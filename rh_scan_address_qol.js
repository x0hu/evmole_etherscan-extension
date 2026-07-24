(function() {
    'use strict';

    const ADDRESS_PATH_PATTERN = /^\/address\/[^/]+\/?$/;
    const DOWNLOAD_LABEL = 'Download Page Data';
    const FILTER_LABEL = 'Filter transactions';
    const NATIVE_INCOMING_LABEL = 'View Incoming Txns';
    const NATIVE_CONTRACT_CREATION_LABEL = 'View Contract Creation';
    const INCOMING_BUTTON_ID = 'evmole-rh-scan-view-incoming';
    const CONTRACT_CREATION_BUTTON_ID = 'evmole-rh-scan-view-contract-creation';
    const HIDDEN_ACTION_ATTRIBUTE = 'data-evmole-rh-scan-native-action';

    const ACTIONS = [
        {
            id: INCOMING_BUTTON_ID,
            label: 'View Incoming',
            nativeLabel: NATIVE_INCOMING_LABEL,
            title: 'View incoming transactions',
            icon: [
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"',
                ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round"',
                ' stroke-linejoin="round" aria-hidden="true" style="display:block">',
                '<path d="M17 7 7 17M15 17H7V9"></path></svg>'
            ].join('')
        },
        {
            id: CONTRACT_CREATION_BUTTON_ID,
            label: 'View CC',
            nativeLabel: NATIVE_CONTRACT_CREATION_LABEL,
            title: 'View contract creation transactions',
            icon: [
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"',
                ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round"',
                ' stroke-linejoin="round" aria-hidden="true" style="display:block">',
                '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12',
                'a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6M10 13h4M10 17h4"></path>',
                '</svg>'
            ].join('')
        }
    ];

    function buttonLabel(button) {
        return String(button?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function findButtonByLabel(root, label) {
        return Array.from(root?.querySelectorAll('button') || [])
            .find(button => buttonLabel(button) === label) || null;
    }

    function findDownloadButton() {
        return findButtonByLabel(document, DOWNLOAD_LABEL);
    }

    function findFilterButton(toolbar) {
        return toolbar?.querySelector(`button[aria-label="${FILTER_LABEL}"]`) || null;
    }

    function findNativeAction(toolbar, nativeLabel) {
        const filterButton = findFilterButton(toolbar);
        return findButtonByLabel(filterButton?.parentElement, nativeLabel);
    }

    function hideNativeMenuActions(toolbar) {
        ACTIONS.forEach(action => {
            const nativeButton = findNativeAction(toolbar, action.nativeLabel);
            if (!nativeButton) return;

            nativeButton.setAttribute(HIDDEN_ACTION_ATTRIBUTE, action.nativeLabel);
            nativeButton.style.setProperty('display', 'none', 'important');
        });
    }

    function waitForNativeAction(toolbar, nativeLabel) {
        return new Promise(resolve => {
            let attempts = 0;
            const maxAttempts = 20;

            function check() {
                const nativeButton = findNativeAction(toolbar, nativeLabel);
                if (nativeButton || attempts++ >= maxAttempts) {
                    resolve(nativeButton);
                    return;
                }
                requestAnimationFrame(check);
            }

            check();
        });
    }

    async function runNativeAction(action, customButton) {
        if (customButton.disabled) return;

        const toolbar = customButton.parentElement;
        if (!toolbar) return;

        customButton.disabled = true;
        customButton.setAttribute('aria-busy', 'true');

        try {
            let nativeButton = findNativeAction(toolbar, action.nativeLabel);
            const filterButton = findFilterButton(toolbar);
            let openedDropdown = false;

            if (!nativeButton && filterButton) {
                filterButton.click();
                openedDropdown = true;
                nativeButton = await waitForNativeAction(toolbar, action.nativeLabel);
            }

            if (nativeButton) {
                nativeButton.click();
            } else if (openedDropdown) {
                filterButton.click();
            }
        } finally {
            customButton.disabled = false;
            customButton.removeAttribute('aria-busy');
        }
    }

    function createActionButton(downloadButton, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = action.id;
        button.className = downloadButton.className;
        button.title = action.title;
        button.setAttribute('aria-label', action.title);
        button.innerHTML = `${action.icon}<span>${action.label}</span>`;
        button.addEventListener('click', () => {
            void runNativeAction(action, button);
        });
        return button;
    }

    function removeCustomButtons() {
        document.getElementById(INCOMING_BUTTON_ID)?.remove();
        document.getElementById(CONTRACT_CREATION_BUTTON_ID)?.remove();
    }

    function syncToolbar() {
        if (!ADDRESS_PATH_PATTERN.test(window.location.pathname)) {
            removeCustomButtons();
            return;
        }

        const downloadButton = findDownloadButton();
        const toolbar = downloadButton?.parentElement;
        if (!downloadButton || !toolbar || !findFilterButton(toolbar)) return;

        let insertionPoint = downloadButton.nextSibling;
        ACTIONS.forEach(action => {
            let button = document.getElementById(action.id);
            if (!button) {
                button = createActionButton(downloadButton, action);
            }

            if (button.parentElement !== toolbar || button !== insertionPoint) {
                toolbar.insertBefore(button, insertionPoint);
            }
            insertionPoint = button.nextSibling;
        });

        hideNativeMenuActions(toolbar);
    }

    let syncScheduled = false;
    function scheduleSync() {
        if (syncScheduled) return;

        syncScheduled = true;
        requestAnimationFrame(() => {
            syncScheduled = false;
            syncToolbar();
        });
    }

    syncToolbar();

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();
