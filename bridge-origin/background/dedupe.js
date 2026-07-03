import { BACKGROUND_RESULT_TTL_MS } from './constants.js';

export function getDedupeKey(message) {
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

export function getBackgroundDedupePromise(inFlightMap, recentResultMap, dedupeKey, createPromise) {
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
