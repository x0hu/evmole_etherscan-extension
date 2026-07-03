import {
    CHAT_SYSTEM_PROMPT,
    CODEX_MODEL,
    SELECTOR_NAME_SYSTEM_PROMPT,
    SUMMARY_SYSTEM_PROMPT,
    SUMMARY_USER_PROMPT_PREFIX,
} from './constants.js';

export function extractJsonText(text) {
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

export function getMessageContentText(content) {
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

export function summarizeRawOutputForError(content) {
    const text = getMessageContentText(content).replace(/\s+/g, ' ').trim();
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

export function normalizeCodexReasoningEffort(value) {
    return ['low', 'medium', 'high'].includes(value) ? value : 'low';
}

export function buildCodexSummaryRequestBody(context, { fastMode = false, reasoningEffort = 'low' } = {}) {
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

export function buildCodexSelectorNamesRequestBody(context, { fastMode = false, reasoningEffort = 'low', retryFeedback = '' } = {}) {
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
                            'Help the UI understand what these unknown function signatures could be used for. Create a simple heuristic function name for each selector that gives better context for how it is used in this contract.',
                            'Return only this JSON shape: {"names":[{"selector":"0x12345678","heuristicName":"shortCamelCaseName","confidence":"high|medium|low","reasoning":"brief context/bytecode/read evidence"}]}.',
                            'Rules:',
                            '- Do not include parameters in heuristicName.',
                            '- context.contextMode may be compact, balanced, or rich. Bytecode may be absent in compact mode; do not fail or invent bytecode evidence when it is absent.',
                            '- Treat context.knownFunctionTable and context.knownFunctionNames as the first and highest-priority vocabulary for the contract domain. Use those declared/resolved names before bytecode to infer whether unknown selectors are launch, tax, fee, hook, treasury, migration, pool, token, owner/admin, wallet, or phase related.',
                            '- If context.readEvidence is present, use successful read values to infer specific constants, addresses, flags, limits, counters, or configuration fields. Mention read evidence briefly in reasoning when it drives the name.',
                            '- Do not name a selector from ABI container shape alone. Avoid tuple/struct/count words such as triple, triples, tuple, tuples, struct, records, entries, items, or batchApplyTriples unless that is clearly contract-domain terminology from bytecode or known names.',
                            '- For nonpayable array/tuple selectors, prefer behavior evidence over argument shape: storage writes, standard events, custom errors, revert strings, and neighboring named functions. For example, ERC721 Approval/Transfer events plus replay/finalized strings should produce a replay/transfer/ownership-style name, not a tuple-shape name.',
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

export function buildCodexChatRequestBody({ question, context, history, fastMode = false, reasoningEffort = 'low' } = {}) {
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

export function extractCodexResponseText(response) {
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

export async function readCodexSseText(response, signal, { startedAt = Date.now() } = {}) {
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
