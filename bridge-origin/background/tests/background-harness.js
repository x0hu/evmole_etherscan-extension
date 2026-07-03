import assert from 'node:assert/strict';
import { createMessageRouter } from '../../background.js';
import {
    BRIDGE_ORIGIN_LOOKUP_TYPE,
    CODEX_CHAT_TYPE,
    CODEX_LOGIN_TYPE,
    CODEX_LOGOUT_TYPE,
    CODEX_SELECTOR_NAMES_TYPE,
    CODEX_STATUS_TYPE,
    CODEX_SUMMARY_TYPE,
    FETCH_TOKEN_URI_TYPE,
    OPENROUTER_CHAT_TYPE,
    OPENROUTER_STATUS_TYPE,
    OPENROUTER_SUMMARY_TYPE,
} from '../constants.js';
import { buildCodexSelectorNamesRequestBody, readCodexSseText } from '../codex-client.js';
import {
    acceptableSelectorNames,
    assessSelectorNameQuality,
    buildSelectorNameRetryContext,
    fillMissingSelectorNames,
    makeSelectorNamesUnique,
    missingSelectorIds,
    normalizeSelectorNamePayload,
} from '../selector-names.js';

function makeSelectorContext(count) {
    const unknownSelectors = Array.from({ length: count }, (_, index) => ({
        selector: `0x${String(index + 1).padStart(8, '0')}`,
        args: '(uint256)',
        mutability: 'view',
        inputTypes: ['uint256'],
        isRead: true,
    }));
    return {
        unknownSelectors,
        unknownSelectorTable: unknownSelectors
            .map(entry => `${entry.selector} ${entry.args} ${entry.mutability} Unknown`)
            .join('\n'),
    };
}

function testSelectorNamePartialCoverage() {
    const context = makeSelectorContext(10);
    const payload = {
        names: context.unknownSelectors.slice(0, 8).map((entry, index) => ({
            selector: entry.selector,
            heuristicName: `specificName${index}`,
            confidence: 'low',
        })),
    };
    const names = normalizeSelectorNamePayload(payload, context);
    const quality = assessSelectorNameQuality(names, context);
    const accepted = makeSelectorNamesUnique(acceptableSelectorNames(names, context));
    const missing = missingSelectorIds(accepted, context);
    const retryContext = buildSelectorNameRetryContext(context, missing);
    const filled = fillMissingSelectorNames(accepted, context);

    assert.equal(quality.ok, false);
    assert.equal(quality.tooSparse, true);
    assert.deepEqual(missing, ['0x00000009', '0x00000010']);
    assert.deepEqual(retryContext.unknownSelectors.map(entry => entry.selector), missing);
    assert.equal(filled.length, 10);
    assert.equal(missingSelectorIds(filled, context).length, 0);
    assert.equal(filled[8].source, 'fallback');
    assert.equal(filled[9].source, 'fallback');
}

function testSelectorNameFiltering() {
    const context = makeSelectorContext(3);
    const payload = {
        names: [
            { selector: '0x00000001', heuristicName: 'readConstant', confidence: 'low' },
            { selector: '0x00000002', heuristicName: 'setFee', confidence: 'low' },
            { selector: '0x00000003', heuristicName: 'specificFeeLookup', confidence: 'medium' },
        ],
    };
    const names = normalizeSelectorNamePayload(payload, context);
    const quality = assessSelectorNameQuality(names, context);
    const accepted = acceptableSelectorNames(names, context);

    assert.equal(quality.generic.includes('readConstant'), true);
    assert.equal(quality.invalidSemantics.some(entry => entry.selector === '0x00000002'), true);
    assert.deepEqual(accepted.map(entry => entry.selector), ['0x00000003']);
}

function testSelectorNameRejectsAbiShapeNames() {
    const context = {
        unknownSelectors: [
            {
                selector: '0x5fc87da5',
                args: '((uint256,uint256,uint256)[])',
                mutability: 'nonpayable',
                inputTypes: ['(uint256,uint256,uint256)[]'],
                isRead: false,
            },
        ],
    };
    const payload = {
        names: [
            { selector: '0x5fc87da5', heuristicName: 'batchApplyPlotTriples', confidence: 'medium' },
        ],
    };
    const names = normalizeSelectorNamePayload(payload, context);
    const quality = assessSelectorNameQuality(names, context);
    const accepted = acceptableSelectorNames(names, context);

    assert.equal(quality.invalidSemantics.some(entry => entry.reason.includes('ABI tuple/struct shape')), true);
    assert.deepEqual(accepted, []);
}

function codexSelectorPromptText(body) {
    return body.input?.[0]?.content?.[0]?.text || '';
}

function testCodexSelectorNamesCompactPrompt() {
    const context = {
        contextMode: 'compact',
        unknownSelectors: [
            { selector: '0x00000001', args: '()', mutability: 'view', inputTypes: [], isRead: true },
        ],
        knownFunctionNames: ['launch', 'treasuryAddress', 'buyTaxBps'],
        knownFunctionTable: '0x11111111 () view treasuryAddress',
        unknownSelectorTable: '0x00000001 () view Unknown',
    };
    const body = buildCodexSelectorNamesRequestBody(context);
    const text = codexSelectorPromptText(body);

    assert.equal(text.includes('Bytecode may be absent in compact mode'), true);
    assert.equal(text.includes('"contextMode":"compact"'), true);
    assert.equal(text.includes('"bytecode"'), false);
}

function testCodexSelectorNamesReadEvidencePrompt() {
    const context = {
        contextMode: 'rich',
        unknownSelectors: [
            { selector: '0x00000002', args: '()', mutability: 'view', inputTypes: [], isRead: true },
        ],
        unknownSelectorTable: '0x00000002 () view Unknown',
        readEvidence: [
            { selector: '0x00000002', signature: 'unknown()', success: true, value: '250', error: null },
        ],
        bytecode: { bytecode: '0x6000', truncated: false, originalChars: 6 },
    };
    const body = buildCodexSelectorNamesRequestBody(context);
    const text = codexSelectorPromptText(body);

    assert.equal(text.includes('context.readEvidence'), true);
    assert.equal(text.includes('"readEvidence"'), true);
    assert.equal(text.includes('"value":"250"'), true);
}

async function testCodexSseTextExtraction() {
    const encoder = new TextEncoder();
    const event = value => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(event({ type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } }));
            controller.enqueue(event({ type: 'response.output_text.delta', delta: '{"ok":' }));
            controller.enqueue(event({ type: 'response.output_text.delta', delta: 'true}' }));
            controller.enqueue(event({
                type: 'response.completed',
                response: {
                    status: 'completed',
                    output: [{ content: [{ type: 'output_text', text: '{"fallback":true}' }] }],
                },
            }));
            controller.close();
        },
    });
    const response = new Response(stream);
    const { text, timing } = await readCodexSseText(response, new AbortController().signal, { startedAt: Date.now() });

    assert.equal(text, '{"ok":true}');
    assert.equal(timing.eventCounts['response.output_text.delta'], 2);
    assert.equal(timing.responseStatus, 'completed');
}

async function testRouterDispatch() {
    const calls = [];
    const handlers = {
        clearCodexCredentials: async () => calls.push('clearCodexCredentials'),
        getCodexStatus: async () => ({ ok: true, status: 'logged_out' }),
        getOpenRouterApiKey: async () => 'key',
        handleBridgeOriginLookup: (message, sendResponse) => {
            calls.push('handleBridgeOriginLookup');
            sendResponse({ ok: true, data: { txHash: message.txHash } });
            return true;
        },
        handleCodexChat: () => calls.push('handleCodexChat'),
        handleCodexSelectorNames: () => calls.push('handleCodexSelectorNames'),
        handleCodexSummary: () => calls.push('handleCodexSummary'),
        handleFetchTokenUri: () => calls.push('handleFetchTokenUri'),
        handleOpenRouterChat: () => calls.push('handleOpenRouterChat'),
        handleOpenRouterSummary: () => calls.push('handleOpenRouterSummary'),
        startCodexLogin: async () => ({ ok: true, status: 'pending' }),
    };
    const router = createMessageRouter(handlers);
    const sent = [];
    const sendResponse = value => sent.push(value);

    assert.equal(router({ type: OPENROUTER_STATUS_TYPE }, null, sendResponse), true);
    await Promise.resolve();
    assert.deepEqual(sent.pop(), { ok: true, hasKey: true });

    assert.equal(router({ type: CODEX_STATUS_TYPE }, null, sendResponse), true);
    await Promise.resolve();
    assert.deepEqual(sent.pop(), { ok: true, status: 'logged_out' });

    assert.equal(router({ type: CODEX_LOGIN_TYPE }, null, sendResponse), true);
    await Promise.resolve();
    assert.deepEqual(sent.pop(), { ok: true, status: 'pending' });

    assert.equal(router({ type: CODEX_LOGOUT_TYPE }, null, sendResponse), true);
    await Promise.resolve();
    assert.deepEqual(sent.pop(), { ok: true, status: 'logged_out' });

    const handlerCases = [
        [OPENROUTER_SUMMARY_TYPE, 'handleOpenRouterSummary'],
        [CODEX_SUMMARY_TYPE, 'handleCodexSummary'],
        [CODEX_SELECTOR_NAMES_TYPE, 'handleCodexSelectorNames'],
        [OPENROUTER_CHAT_TYPE, 'handleOpenRouterChat'],
        [CODEX_CHAT_TYPE, 'handleCodexChat'],
        [FETCH_TOKEN_URI_TYPE, 'handleFetchTokenUri'],
    ];
    for (const [type, expectedCall] of handlerCases) {
        assert.equal(router({ type }, null, sendResponse), true);
        assert.equal(calls.pop(), expectedCall);
    }

    assert.equal(router({
        type: BRIDGE_ORIGIN_LOOKUP_TYPE,
        txHash: `0x${'1'.repeat(64)}`,
    }, null, sendResponse), true);
    assert.equal(calls.pop(), 'handleBridgeOriginLookup');
    assert.equal(router({ type: 'unknown' }, null, sendResponse), false);
}

testSelectorNamePartialCoverage();
testSelectorNameFiltering();
testSelectorNameRejectsAbiShapeNames();
testCodexSelectorNamesCompactPrompt();
testCodexSelectorNamesReadEvidencePrompt();
await testCodexSseTextExtraction();
await testRouterDispatch();
console.log('background harness passed');
