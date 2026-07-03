export function getOpenRouterApiKey() {
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

export function localStorageGet(defaults) {
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

export function localStorageSet(values) {
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

export function localStorageRemove(keys) {
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
