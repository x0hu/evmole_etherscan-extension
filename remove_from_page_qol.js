const TARGET_PAGE_PATH = /^\/(?:address|tx)(?:\/|$)/;
const FEATURED_BANNER_SELECTOR = 'section.container-xxl';
const FEATURED_BANNER_RESULT_SELECTOR = '.py-4.noindex-section[data-nosnippet] span#ContentPlaceHolder1_lblAdResult';
const FEATURED_BANNER_REVIVE_MARKERS = [
  'ins[data-revive-id="fb7ca7d4362180864a0c74f8efefe11d"]',
  'ins[data-revive-em9uzwlk="32"]',
  'script[src*="xuv.etherscan.com"]'
];
const FEATURED_BANNER_REVIVE_SELECTOR = FEATURED_BANNER_REVIVE_MARKERS.join(', ');
const SPONSORED_DROPDOWN_ROW_SELECTOR = 'div.d-flex.gap-2.noindex-section[data-nosnippet]';

const PAGE_REMOVAL_RULES = [
  {
    containerSelector: FEATURED_BANNER_SELECTOR,
    matches(node) {
      const adResult = node.querySelector(FEATURED_BANNER_RESULT_SELECTOR);
      if (!adResult) {
        return false;
      }

      return Boolean(node.querySelector(FEATURED_BANNER_REVIVE_SELECTOR));
    }
  },
  {
    containerSelector: SPONSORED_DROPDOWN_ROW_SELECTOR,
    matches(node) {
      const directChildren = Array.from(node.children);
      if (directChildren.length === 0) {
        return false;
      }

      if (directChildren.some((child) => !child.classList.contains('dropdown'))) {
        return false;
      }

      return directChildren.every(isSponsoredDropdown);
    }
  }
];

if (TARGET_PAGE_PATH.test(window.location.pathname)) {
  removePageQolElements(document);
  watchForPageQolCleanup();
}

function isSponsoredDropdown(dropdown) {
  const toggleButton = dropdown.querySelector(':scope > button.btn.btn-sm.btn-primary.dropdown-toggle');
  const menu = dropdown.querySelector(':scope > .dropdown-menu');
  if (!toggleButton || !menu) {
    return false;
  }

  const advertiserLinks = Array.from(
    menu.querySelectorAll('a[title="Links to an External Advertiser site"]')
  );

  if (advertiserLinks.length === 0) {
    return false;
  }

  const hasGotoRedirect = advertiserLinks.some((link) => isGotoRedirectLink(link.href));
  if (!hasGotoRedirect) {
    return false;
  }

  return hasSponsoredLabel(menu);
}

function hasSponsoredLabel(menu) {
  return Array.from(menu.querySelectorAll('*')).some(
    (node) => normalizeText(node.textContent) === 'Sponsored'
  );
}

function isGotoRedirectLink(href) {
  try {
    return new URL(href, window.location.origin).hostname.startsWith('goto.');
  } catch {
    return false;
  }
}

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function getMatchingNodes(root, selector) {
  if (root.nodeType === Node.DOCUMENT_NODE) {
    return Array.from(root.querySelectorAll(selector));
  }

  if (root.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const matches = root.matches(selector) ? [root] : [];
  return matches.concat(Array.from(root.querySelectorAll(selector)));
}

function removePageQolElements(root) {
  PAGE_REMOVAL_RULES.forEach((rule) => {
    getMatchingNodes(root, rule.containerSelector).forEach((node) => {
      if (rule.matches(node)) {
        node.remove();
      }
    });
  });
}

function watchForPageQolCleanup() {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        removePageQolElements(node);
      }
    }
  });

  observer.observe(document, {
    childList: true,
    subtree: true
  });

  document.addEventListener(
    'DOMContentLoaded',
    () => {
      removePageQolElements(document);
    },
    { once: true }
  );
}
