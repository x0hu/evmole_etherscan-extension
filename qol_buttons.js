(function() {
    'use strict';

    // Check if the script has already run
    if (window.hasRunQOLButtonScript) return;
    window.hasRunQOLButtonScript = true;

    // Auto-select 100 records per page
    function autoSelect100() {
        const dropdown = document.querySelector('select[name="ctl00$ContentPlaceHolder1$ddlRecordsPerPage"]');
        if (dropdown) {
            const option100 = dropdown.querySelector('option[value="100"]');
            if (option100 && !option100.selected) {
                option100.selected = true;
                // Trigger change event to ensure the selection is processed
                dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        return false;
    }

    // Function to get the address dynamically from the URL
    function getAddressFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const addressParam = urlParams.get('a');
        if (addressParam) {
            return addressParam;
        }
        const urlParts = window.location.pathname.split('/');
        return urlParts[urlParts.length - 1];
    }

    // Function to detect if we're on a Base/Blast scan site (dropdown method)
    function isDropdownBasedSite() {
        const hostname = window.location.hostname;
        return hostname.includes('basescan.org') || hostname.includes('blastscan.io');
    }

    // Method 1: For Base/Blast - uses existing dropdown links
    function addButtonsViaDropdown() {
        const downloadButton = document.getElementById('btnExportQuickTableToCSV');
        if (!downloadButton) return false;

        const buttonContainer = downloadButton.parentNode;

        // Remove any existing custom buttons to prevent duplication
        const existingButtons = buttonContainer.querySelectorAll('.custom-etherscan-button');
        existingButtons.forEach(button => button.remove());

        function createButton(text, onClick, id) {
            const button = document.createElement('button');
            button.textContent = text;
            button.id = id;
            button.className = downloadButton.className + ' custom-etherscan-button';
            button.style.marginLeft = '5px';
            button.addEventListener('click', onClick);
            return button;
        }

        function viewIncomingTxns() {
            const incomingTxnsLink = document.querySelector('a.dropdown-item[href*="f=3"]');
            if (incomingTxnsLink) window.location.href = incomingTxnsLink.href;
        }

        function viewContractCreations() {
            const contractCreationsLink = document.querySelector('a.dropdown-item[href*="f=5"]');
            if (contractCreationsLink) window.location.href = contractCreationsLink.href;
        }

        const incomingTxnsButton = createButton('Incoming', viewIncomingTxns, 'customIncomingTxnsButton');
        const contractCreationsButton = createButton('CA Creations', viewContractCreations, 'customContractCreationsButton');

        // Insert buttons in the correct order: Download Page Data, Incoming Txns, Contract Creations
        buttonContainer.insertBefore(contractCreationsButton, downloadButton.nextSibling);
        buttonContainer.insertBefore(incomingTxnsButton, contractCreationsButton);

        return true;
    }

    // Method 2: For other chains - uses direct URL navigation
    function addButtonsViaUrlNavigation() {
        const address = getAddressFromUrl();
        if (!address) return false;

        // Select all containers with the specified class names
        const containers = document.querySelectorAll('.d-flex.gap-2.flex-wrap, .d-flex.flex-wrap.align-items-center.justify-content-between.gap-2');

        let buttonsAdded = false;
        containers.forEach(container => {
            // Ensure the container contains the "Download Page Data" button
            const downloadButton = container.querySelector('button[id^="btnExportQuick"][type="button"]');
            if (downloadButton) {
                // Check if buttons already exist to prevent duplication
                if (container.querySelector('#btnViewIncomingTxns')) return;

                // Create a new button for "View Incoming Txns"
                const viewIncomingTxnsButton = document.createElement('button');
                viewIncomingTxnsButton.type = 'button';
                viewIncomingTxnsButton.className = 'btn btn-sm btn-white text-nowrap';
                viewIncomingTxnsButton.id = 'btnViewIncomingTxns';
                viewIncomingTxnsButton.innerHTML = '<i class="fas fa-long-arrow-alt-left text-muted me-1"></i> Incoming';
                viewIncomingTxnsButton.onclick = function() {
                    window.location.href = `/txs?a=${address}&f=3`;
                };

                // Create a new button for "View Contract Creation"
                const viewContractCreationButton = document.createElement('button');
                viewContractCreationButton.type = 'button';
                viewContractCreationButton.className = 'btn btn-sm btn-white text-nowrap';
                viewContractCreationButton.id = 'btnViewContractCreation';
                viewContractCreationButton.innerHTML = '<i class="fas fa-newspaper text-muted me-1"></i> CA Create';
                viewContractCreationButton.onclick = function() {
                    window.location.href = `/txs?a=${address}&f=5`;
                };

                // Insert the new buttons after the "Download Page Data" button
                container.insertBefore(viewIncomingTxnsButton, downloadButton.nextSibling);
                container.insertBefore(viewContractCreationButton, viewIncomingTxnsButton.nextSibling);
                buttonsAdded = true;
            }
        });

        return buttonsAdded;
    }

    // Main function to add buttons based on the site
    function addQOLButtons() {
        if (isDropdownBasedSite()) {
            return addButtonsViaDropdown();
        } else {
            return addButtonsViaUrlNavigation();
        }
    }

    // Try to add buttons and auto-select 100 immediately
    if (!addQOLButtons()) {
        // If buttons weren't added, keep trying every 100ms for up to 5 seconds
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds total
        const interval = setInterval(() => {
            if (addQOLButtons()) {
                clearInterval(interval);
            } else if (++attempts >= maxAttempts) {
                clearInterval(interval);
                console.log('Failed to add QOL buttons after 5 seconds');
            }
        }, 100);
    }

    // Try to auto-select 100 records per page
    if (!autoSelect100()) {
        // Keep trying for the dropdown to appear
        let dropdownAttempts = 0;
        const maxDropdownAttempts = 30; // 3 seconds total
        const dropdownInterval = setInterval(() => {
            if (autoSelect100()) {
                clearInterval(dropdownInterval);
            } else if (++dropdownAttempts >= maxDropdownAttempts) {
                clearInterval(dropdownInterval);
            }
        }, 100);
    }

    // Also listen for page changes (for SPAs)
    let currentUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            // Reset the flag and try adding buttons again
            window.hasRunQOLButtonScript = false;
            setTimeout(() => {
                if (!window.hasRunQOLButtonScript) {
                    window.hasRunQOLButtonScript = true;
                    addQOLButtons();
                    autoSelect100();
                }
            }, 500);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();