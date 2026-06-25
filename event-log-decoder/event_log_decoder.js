// Event log decoder for Etherscan-family transaction receipt pages.
(function() {
  'use strict';

  const RAW_DATA_SELECTOR = "[id^='event_raw_data_']";
  const BRIDGE_ID = 'evmole-eventlog-view-bridge';
  const VIEW_EVENT_NAME = 'EVMOLE_EVENTLOG_SET_VIEW';
  const MAX_LOGS_TO_RENDER = 250;
  let bridgeLoaded = false;
  let renderInFlight = false;
  let prefetchInFlight = false;
  let lastAttemptKey = '';
  let prefetchedAttemptKey = '';
  let prefetchedEventLogPaneHtml = '';
  let applyTimer = null;
  const bridgeQueue = [];

  function normalizeHex(value) {
    if (typeof value !== 'string') return '0x';
    const trimmed = value.trim();
    const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
    return /^0x[0-9a-fA-F]*$/.test(prefixed) ? prefixed.toLowerCase() : '0x';
  }

  function cleanHexText(value) {
    const text = String(value || '');
    const chunks = text.match(/0x[0-9a-fA-F]+|[0-9a-fA-F]{64,}/g) || [];
    const clean = chunks.map(chunk => chunk.replace(/^0x/i, '')).join('');
    return clean ? `0x${clean}` : '0x';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getTxHashFromPath() {
    const match = window.location.pathname.match(/\/tx\/(0x[a-fA-F0-9]{64})/);
    return match ? match[1] : null;
  }

  function isAddressValue(value) {
    return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
  }

  function getExplorerAddressUrl(value) {
    if (!isAddressValue(value)) return null;
    return `${window.location.origin}/address/${value}`;
  }

  function getEventNumber(rawDataElement) {
    const match = rawDataElement?.id?.match(/^event_raw_data_(\d+)$/);
    return match ? match[1] : null;
  }

  function getRawDataElements(root = document) {
    return Array.from(root.querySelectorAll(RAW_DATA_SELECTOR))
      .map(element => ({ element, eventNumber: getEventNumber(element) }))
      .filter(entry => entry.eventNumber);
  }

  function getWord(hex, index) {
    const clean = normalizeHex(hex).slice(2);
    return `0x${clean.slice(index * 64, index * 64 + 64).padEnd(64, '0')}`;
  }

  function splitWords(hex) {
    const clean = normalizeHex(hex).slice(2);
    const words = [];
    for (let i = 0; i + 64 <= clean.length; i += 64) {
      words.push(`0x${clean.slice(i, i + 64)}`);
    }
    return words;
  }

  function byteLength(hex) {
    return normalizeHex(hex).slice(2).length / 2;
  }

  function slice(hex, start, end) {
    const clean = normalizeHex(hex).slice(2);
    const s = start * 2;
    const e = end === undefined ? undefined : end * 2;
    return `0x${clean.slice(s, e)}`;
  }

  function safeBigInt(hex) {
    try {
      return BigInt(normalizeHex(hex));
    } catch {
      return null;
    }
  }

  function wordToNumber(word) {
    const value = safeBigInt(word);
    if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }

  function wordToAddress(word) {
    const clean = normalizeHex(word).slice(2).padStart(64, '0');
    return `0x${clean.slice(24)}`;
  }

  function isLikelyAddressWord(word) {
    const clean = normalizeHex(word).slice(2).padStart(64, '0');
    if (!/^0{24}/.test(clean)) return false;
    const low = BigInt(`0x${clean.slice(24)}`);
    if (low === 0n) return false;
    return low > 0xffffffffffffffffn;
  }

  function hexToBytes(hex) {
    const clean = normalizeHex(hex).slice(2);
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return bytes;
  }

  function isMostlyPrintable(text) {
    if (!text) return false;
    let printable = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable++;
    }
    return printable / text.length > 0.8;
  }

  function tryUtf8(hex) {
    try {
      const text = new TextDecoder().decode(hexToBytes(hex)).replace(/\0+$/g, '');
      return isMostlyPrintable(text) ? text : null;
    } catch {
      return null;
    }
  }

  function hexToString(hex) {
    return new TextDecoder().decode(hexToBytes(hex));
  }

  function isValidUtf8(hex) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(hex));
      return true;
    } catch {
      return false;
    }
  }

  function parseSignatureTypes(signature) {
    const start = signature.indexOf('(');
    const end = signature.lastIndexOf(')');
    if (start === -1 || end === -1 || end <= start) return [];

    const inner = signature.slice(start + 1, end);
    if (!inner.trim()) return [];

    const types = [];
    let current = '';
    let depth = 0;
    for (const char of inner) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) {
        types.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) types.push(current.trim());
    return types;
  }

  function isDynamicType(type) {
    if (type === 'string' || type === 'bytes') return true;
    if (type.endsWith('[]')) return true;
    if (type.startsWith('(')) {
      return parseSignatureTypes(type).some(isDynamicType);
    }
    return false;
  }

  function decodeParam(data, offset, type) {
    const dataLen = byteLength(data);
    if (offset >= dataLen) return { value: 'N/A', len: 32, type };

    const word = slice(data, offset, offset + 32);
    if (word.length < 6) return { value: 'N/A', len: 32, type };

    const paddedWord = word.length < 66 ? word.padEnd(66, '0') : word;
    const wordVal = BigInt(paddedWord);

    if (type === 'address') {
      return { value: `0x${paddedWord.slice(26)}`, len: 32, type: 'address' };
    }
    if (type === 'bool') {
      return { value: wordVal === 1n, len: 32, type: 'bool' };
    }
    if (type.endsWith('[]')) {
      return decodeArray(data, Number(wordVal), type.slice(0, -2));
    }
    if (type.startsWith('uint')) {
      return { value: wordVal.toString(), len: 32, type };
    }
    if (type.startsWith('int')) {
      const bits = parseInt(type.slice(3), 10) || 256;
      const max = 1n << BigInt(bits);
      const signed = wordVal >= (max >> 1n) ? wordVal - max : wordVal;
      return { value: signed.toString(), len: 32, type };
    }
    if (/^bytes([1-9]|[12][0-9]|3[0-2])$/.test(type)) {
      const size = Number(type.slice(5));
      return { value: slice(word, 0, size), len: 32, type };
    }
    if (type === 'bytes32') {
      return { value: word, len: 32, type: 'bytes32' };
    }
    if (type === 'string' || type === 'bytes') {
      return decodeDynamic(data, Number(wordVal), type);
    }
    if (type.startsWith('(')) {
      return isDynamicType(type)
        ? decodeTuple(data, Number(wordVal), type)
        : decodeTupleInline(data, offset, type);
    }

    return { value: wordVal.toString(), len: 32, type: 'uint256' };
  }

  function decodeDynamic(data, ptr, type) {
    try {
      const lenWord = slice(data, ptr, ptr + 32);
      const lenBig = safeBigInt(lenWord);
      if (lenBig === null) return { value: 'invalid', len: 32, type };

      const len = Number(lenBig);
      if (len === 0) return { value: type === 'string' ? '' : '0x', len: 32, type };
      if (len < 0 || ptr + 32 + len > byteLength(data)) return { value: 'invalid', len: 32, type };

      const content = slice(data, ptr + 32, ptr + 32 + len);
      if (type === 'string' && isValidUtf8(content)) {
        return { value: hexToString(content), len: 32, type: 'string' };
      }
      return { value: content, len: 32, type: 'bytes' };
    } catch {
      return { value: 'decode error', len: 32, type };
    }
  }

  function decodeArray(data, ptr, elemType) {
    try {
      const lenWord = slice(data, ptr, ptr + 32);
      const lenBig = safeBigInt(lenWord);
      if (lenBig === null) return { value: [], len: 32, type: `${elemType}[]` };

      const len = Number(lenBig);
      const elements = [];
      const isDynamic = isDynamicType(elemType);

      if (isDynamic) {
        const arrayDataStart = ptr + 32;
        for (let i = 0; i < len && i < 20; i++) {
          const offsetWord = slice(data, arrayDataStart + i * 32, arrayDataStart + (i + 1) * 32);
          const elemOffsetBig = safeBigInt(offsetWord);
          if (elemOffsetBig === null) break;

          const elemPtr = arrayDataStart + Number(elemOffsetBig);
          if (elemType.startsWith('(')) {
            elements.push(decodeTuple(data, elemPtr, elemType).value);
          } else {
            elements.push(decodeDynamic(data, elemPtr, elemType).value);
          }
        }
      } else {
        let curOffset = ptr + 32;
        for (let i = 0; i < len && i < 20; i++) {
          const elem = decodeParam(data, curOffset, elemType);
          elements.push(elem.value);
          curOffset += elem.len;
        }
      }

      return { value: elements, len: 32, type: `${elemType}[]` };
    } catch {
      return { value: [], len: 32, type: `${elemType}[]` };
    }
  }

  function decodeTupleInline(data, offset, type) {
    try {
      const types = parseSignatureTypes(type);
      const values = [];
      let curOffset = offset;
      const dataLen = byteLength(data);

      for (const innerType of types) {
        if (curOffset >= dataLen) break;
        const res = decodeParam(data, curOffset, innerType);
        values.push(res.value);
        curOffset += res.len;
      }

      return { value: values, len: curOffset - offset, type: 'tuple' };
    } catch {
      return { value: [], len: 32, type: 'tuple' };
    }
  }

  function decodeTuple(data, ptr, type) {
    try {
      const types = parseSignatureTypes(type);
      const values = [];
      const dataLen = byteLength(data);

      for (let i = 0; i < types.length; i++) {
        const innerType = types[i];
        const headOffset = ptr + i * 32;
        if (headOffset >= dataLen) break;

        if (isDynamicType(innerType)) {
          const offsetWord = slice(data, headOffset, headOffset + 32);
          const offsetBig = safeBigInt(offsetWord);
          if (offsetBig === null) {
            values.push('N/A');
            continue;
          }

          const actualPtr = ptr + Number(offsetBig);
          if (innerType === 'bytes' || innerType === 'string') {
            values.push(decodeDynamic(data, actualPtr, innerType).value);
          } else if (innerType.endsWith('[]')) {
            values.push(decodeArray(data, actualPtr, innerType.slice(0, -2)).value);
          } else if (innerType.startsWith('(')) {
            values.push(decodeTuple(data, actualPtr, innerType).value);
          } else {
            values.push('N/A');
          }
        } else {
          values.push(decodeParam(data, headOffset, innerType).value);
        }
      }

      return { value: values, len: 32, type: 'tuple' };
    } catch {
      return { value: [], len: 32, type: 'tuple' };
    }
  }

  function decodeDynamicValue(dataHex, offset) {
    const totalBytes = byteLength(dataHex);
    if (offset < 0 || offset % 32 !== 0 || offset + 32 > totalBytes) return null;

    const length = wordToNumber(getWord(dataHex, offset / 32));
    if (length === null || length < 0 || offset + 32 + length > totalBytes) return null;

    const clean = normalizeHex(dataHex).slice(2);
    const start = (offset + 32) * 2;
    const valueHex = `0x${clean.slice(start, start + length * 2)}`;
    const text = tryUtf8(valueHex);

    if (text !== null) {
      return { type: 'string', value: text, rawValue: valueHex };
    }

    return { type: 'bytes', value: valueHex, rawValue: valueHex };
  }

  function inferStaticParam(word, name) {
    const value = safeBigInt(word);
    if (value === 0n || value === 1n) {
      return { type: 'bool', name, value: value === 1n ? 'true' : 'false', rawValue: word };
    }

    if (isLikelyAddressWord(word)) {
      return { type: 'address', name, value: wordToAddress(word), rawValue: word };
    }

    if (value !== null) {
      return { type: 'uint256', name, value: value.toString(), rawValue: word };
    }

    return { type: 'bytes32', name, value: word, rawValue: word };
  }

  function inferTopicParam(topic, index) {
    const word = normalizeHex(topic);
    const name = `topic${index}`;

    if (isLikelyAddressWord(word)) {
      return { type: 'address', name, value: wordToAddress(word), rawValue: word, indexed: true };
    }

    return { ...inferStaticParam(word, name), indexed: true };
  }

  class PType {
    constructor(typeStr) {
      this.type = typeStr;
      this._baseType = null;
      this._components = null;
      this._arrayChildren = null;
      this._parse();
    }

    _parse() {
      if (this.type.endsWith('[]')) {
        this._baseType = 'array';
        this._arrayChildren = PType.from(this.type.slice(0, -2));
      } else if (this.type.startsWith('(') && this.type.endsWith(')')) {
        this._baseType = 'tuple';
        const inner = this.type.slice(1, -1);
        if (!inner) {
          this._components = [];
          return;
        }
        this._components = parseSignatureTypes(this.type).map(part => PType.from(part));
      } else {
        this._baseType = this.type;
      }
    }

    get baseType() { return this._baseType; }
    get components() { return this._components || []; }
    get arrayChildren() { return this._arrayChildren; }
    isTuple() { return this._baseType === 'tuple'; }
    isArray() { return this._baseType === 'array'; }
    format() { return this.type; }
    static from(typeStr) { return new PType(typeStr); }
    static isParamType(value) { return value instanceof PType; }
  }

  function gEncodeHex(data) {
    const parts = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      parts[i] = data[i].toString(16).padStart(2, '0');
    }
    return `0x${parts.join('')}`;
  }

  function gDecodeHex(hex) {
    const clean = normalizeHex(hex).slice(2);
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  function gIsSafe(value) {
    return value < BigInt(Number.MAX_SAFE_INTEGER);
  }

  function gTryParseOffset(data, pos) {
    const word = data.slice(pos, pos + 32);
    if (word.length === 0) return null;

    const big = BigInt(gEncodeHex(word));
    if (!gIsSafe(big)) return null;

    const offset = Number(big);
    if (offset <= pos || offset >= data.length) return null;
    if (offset % 32 !== 0) return null;
    return offset;
  }

  function gTryParseLength(data, offset) {
    const word = data.slice(offset, offset + 32);
    if (word.length === 0) return null;

    const big = BigInt(gEncodeHex(word));
    if (!gIsSafe(big)) return null;

    const length = Number(big);
    if (offset + 32 + length > data.length) return null;
    return length;
  }

  function gCountLeadingZeros(bytes) {
    let count = 0;
    for (const byte of bytes) {
      if (byte !== 0) break;
      count++;
    }
    return count;
  }

  function gCountTrailingZeros(bytes) {
    let count = 0;
    for (let i = bytes.length - 1; i >= 0; i--) {
      if (bytes[i] !== 0) break;
      count++;
    }
    return count;
  }

  function gFormatParams(params) {
    return params.map(param => param.format()).join(',');
  }

  function gGenerateConsistentResult(params) {
    if (params.length === 0) return null;

    if (params[0].isTuple() && params[0].components.length > 0) {
      if (params.find(param => !param.isTuple())) return null;
      if (new Set(params.map(param => param.components.length)).size !== 1) return null;

      const components = [];
      for (let i = 0; i < params[0].components.length; i++) {
        const component = gGenerateConsistentResult(params.map(param => param.components[i]));
        if (!component) return null;
        components.push(component);
      }
      return PType.from(`(${gFormatParams(components)})`);
    }

    if (params[0].isArray()) {
      if (params.find(param => !param.isArray())) return null;
      const child = gGenerateConsistentResult(params.map(param => param.arrayChildren));
      return child ? PType.from(`${child.format()}[]`) : null;
    }

    const checker = new Set(params.map(param => param.format() === '()[]' ? 'bytes' : param.format()));
    return checker.size === 1 ? PType.from(checker.values().next().value) : null;
  }

  function gTestParams(params, data) {
    if (!params) return false;
    try {
      const hex = gEncodeHex(data);
      let offset = 0;
      for (const param of params) {
        const res = decodeParam(hex, offset, param.format());
        if (res.value === 'N/A' || res.value === 'decode error' || res.value === 'invalid') return false;
        offset += res.len;
      }
      return true;
    } catch {
      return false;
    }
  }

  function gDecodeValues(params, data) {
    const hex = gEncodeHex(data);
    const values = [];
    let offset = 0;
    for (const param of params) {
      const res = decodeParam(hex, offset, param.format());
      values.push(res.value);
      offset += res.len;
    }
    return values;
  }

  function decodeWellFormedTuple(depth, data, paramIdx, collectedParams, endOfStaticCalldata, expectedLength, isDynamicArrayElement) {
    const testParams = params => gTestParams(params, data);
    const paramOffset = paramIdx * 32;

    if (paramOffset < endOfStaticCalldata) {
      const maybeOffset = gTryParseOffset(data, paramOffset);
      if (maybeOffset !== null) {
        const maybeLength = gTryParseLength(data, maybeOffset);

        if (maybeLength !== null && (isDynamicArrayElement === null || isDynamicArrayElement === true)) {
          const fragment = decodeWellFormedTuple(
            depth,
            data,
            paramIdx + 1,
            [...collectedParams, { offset: maybeOffset, length: maybeLength }],
            Math.min(endOfStaticCalldata, maybeOffset),
            expectedLength,
            isDynamicArrayElement
          );
          if (testParams(fragment)) return fragment;
        }

        if (isDynamicArrayElement === null || isDynamicArrayElement === false) {
          const fragment = decodeWellFormedTuple(
            depth,
            data,
            paramIdx + 1,
            [...collectedParams, { offset: maybeOffset, length: null }],
            Math.min(endOfStaticCalldata, maybeOffset),
            expectedLength,
            isDynamicArrayElement
          );
          if (testParams(fragment)) return fragment;
        }
      }

      if (isDynamicArrayElement !== null) return null;

      const fragment = decodeWellFormedTuple(
        depth,
        data,
        paramIdx + 1,
        [...collectedParams, PType.from('bytes32')],
        endOfStaticCalldata,
        expectedLength,
        isDynamicArrayElement
      );
      return testParams(fragment) ? fragment : null;
    }

    if (expectedLength !== null && collectedParams.length !== expectedLength) return null;

    const maybeResolveDynamicParam = index => {
      const param = collectedParams[index];
      if (PType.isParamType(param)) return param;

      const nextDynamic = collectedParams.find((value, i) => i > index && !PType.isParamType(value));
      const isTrailing = nextDynamic === undefined;
      const maybeDynLen = param.length;
      const dynStart = param.offset + (maybeDynLen !== null ? 32 : 0);
      const dynEnd = isTrailing ? data.length : nextDynamic.offset;
      const dynData = data.slice(dynStart, dynEnd);

      if (maybeDynLen === null) {
        const params = decodeWellFormedTuple(depth + 1, dynData, 0, [], dynData.length, null, null);
        return params ? PType.from(`(${gFormatParams(params)})`) : undefined;
      }

      if (maybeDynLen === 0) return PType.from('()[]');

      if (
        maybeDynLen === dynData.length ||
        (dynData.length % 32 === 0 &&
          dynData.length - maybeDynLen < 32 &&
          dynData.slice(maybeDynLen).filter(byte => byte !== 0).length === 0)
      ) {
        return PType.from('bytes');
      }

      const allResults = [];
      const dynamicArrayWithLength = decodeWellFormedTuple(depth + 1, dynData, 0, [], dynData.length, maybeDynLen, true);
      if (dynamicArrayWithLength) allResults.push(dynamicArrayWithLength);

      const dynamicArrayNoLength = decodeWellFormedTuple(depth + 1, dynData, 0, [], dynData.length, maybeDynLen, false);
      if (dynamicArrayNoLength) allResults.push(dynamicArrayNoLength);

      const numWords = dynData.length / 32;
      const wordsPerElement = Math.floor(numWords / maybeDynLen);
      const staticParsed = [];
      let ok = maybeDynLen > 0 && wordsPerElement > 0;
      for (let elementIndex = 0; elementIndex < maybeDynLen && ok; elementIndex++) {
        const chunk = dynData.slice(elementIndex * wordsPerElement * 32, (elementIndex + 1) * wordsPerElement * 32);
        const params = decodeWellFormedTuple(depth + 1, chunk, 0, [], chunk.length, null, null);
        if (!params || params.length === 0) {
          ok = false;
          break;
        }
        staticParsed.push(params.length > 1 ? PType.from(`(${gFormatParams(params)})`) : params[0]);
      }
      if (ok && staticParsed.length > 0) allResults.push(staticParsed);

      const validResults = allResults
        .map(result => gGenerateConsistentResult(result))
        .filter(value => value !== null && value.format() !== '()[]')
        .sort((a, b) => a.format().length - b.format().length);

      return validResults.length === 0 ? undefined : PType.from(`${validResults[0].format()}[]`);
    };

    const finalParams = [];
    for (let i = 0; i < collectedParams.length; i++) {
      const decoded = maybeResolveDynamicParam(i);
      if (!decoded) return null;
      finalParams.push(decoded);
    }

    return testParams(finalParams) ? finalParams : null;
  }

  function gMergeTypes(types) {
    if (types.length === 0) return PType.from('()');
    if (types.length === 1) return types[0];

    const bases = new Set(types.map(type => type.baseType));
    if (bases.size === 1) {
      const base = bases.values().next().value;
      if (base === 'tuple') {
        const components = types.map(type => type.components);
        if (new Set(components.map(component => component.length)).size !== 1) return PType.from('()');
        const merged = [];
        for (let i = 0; i < components[0].length; i++) {
          merged.push(gMergeTypes(components.map(component => component[i])));
        }
        return PType.from(`(${gFormatParams(merged)})`);
      }
      if (base === 'array') {
        return PType.from(`${gMergeTypes(types.map(type => type.arrayChildren)).format()}[]`);
      }
    }

    const typeSet = new Set(types.map(type => type.type));
    if (typeSet.size === 1) return types[0];
    if (typeSet.has('bytes')) return PType.from('bytes');
    if (typeSet.has('uint256')) return PType.from('uint256');
    return PType.from('bytes32');
  }

  function gInferTypes(params, values) {
    return params.map((param, index) => {
      const value = values[index];
      if (param.isTuple()) {
        return PType.from(`(${gFormatParams(gInferTypes(param.components, value))})`);
      }
      if (param.isArray()) {
        const childTypes = Array(Array.isArray(value) ? value.length : 0).fill(param.arrayChildren);
        const inferredChildren = gInferTypes(childTypes, Array.isArray(value) ? value : []);
        return PType.from(`${gMergeTypes(inferredChildren).format()}[]`);
      }
      if (param.type === 'bytes32') {
        const raw = typeof value === 'string' ? gDecodeHex(value) : new Uint8Array(32);
        const leadingZeros = gCountLeadingZeros(raw);
        const trailingZeros = gCountTrailingZeros(raw);
        if (leadingZeros >= 12 && leadingZeros <= 17) return PType.from('address');
        if (leadingZeros > 16) return PType.from('uint256');
        if (trailingZeros > 0) return PType.from(`bytes${32 - trailingZeros}`);
        return PType.from('bytes32');
      }
      if (param.type === 'bytes') {
        if (typeof value === 'string' && value.startsWith('0x') && value.length > 2) {
          try {
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(gDecodeHex(value));
            if (decoded.length > 0) return PType.from('string');
          } catch {}
        }
        return PType.from('bytes');
      }
      return param;
    });
  }

  function guessAbiEncodedData(hexData) {
    const data = gDecodeHex(hexData);
    if (data.length === 0 || data.length % 32 !== 0) return null;

    const params = decodeWellFormedTuple(0, data, 0, [], data.length, null, null);
    if (!params) return null;

    try {
      return gInferTypes(params, gDecodeValues(params, data));
    } catch {
      return params;
    }
  }

  function valueToRawHex(value, fallbackWord) {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)) return normalizeHex(value);
    return fallbackWord || '0x';
  }

  function valueToDisplay(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'bigint') return value.toString();
    return String(value);
  }

  function tryGuessABIStructure(dataHex) {
    const clean = normalizeHex(dataHex).slice(2);
    if (clean.length < 64) return null;

    const alignedHex = clean.slice(0, Math.floor(clean.length / 64) * 64);
    if (alignedHex.length < 64) return null;

    const guessedTypes = guessAbiEncodedData(`0x${alignedHex}`);
    if (!guessedTypes || guessedTypes.length === 0) return null;

    const types = guessedTypes.map(type => type.format());
    const params = [];
    let offset = 0;

    for (let i = 0; i < types.length; i++) {
      const res = decodeParam(dataHex, offset, types[i]);
      if (res.value === 'N/A' || res.value === 'decode error' || res.value === 'invalid') return null;
      params.push({
        name: `data${i}`,
        type: types[i],
        value: valueToDisplay(res.value),
        rawValue: valueToRawHex(res.value, getWord(dataHex, offset / 32))
      });
      offset += res.len;
    }

    return params;
  }

  function inferEventHeadTailParams(dataHex) {
    const words = splitWords(dataHex);
    if (words.length === 0) return [];

    const dynamicByIndex = new Map();
    let firstDynamicOffset = null;

    words.forEach((word, index) => {
      const offset = wordToNumber(word);
      if (offset === null || offset < 32 || offset % 32 !== 0 || offset >= byteLength(dataHex)) return;

      const decoded = decodeDynamicValue(dataHex, offset);
      if (!decoded) return;

      dynamicByIndex.set(index, decoded);
      if (firstDynamicOffset === null || offset < firstDynamicOffset) {
        firstDynamicOffset = offset;
      }
    });

    const headCount = firstDynamicOffset === null
      ? words.length
      : Math.min(words.length, Math.max(0, firstDynamicOffset / 32));

    const params = [];
    for (let i = 0; i < headCount; i++) {
      const dynamic = dynamicByIndex.get(i);
      if (dynamic) {
        params.push({
          type: dynamic.type,
          name: `data${params.length}`,
          value: dynamic.value,
          rawValue: dynamic.rawValue
        });
      } else {
        params.push(inferStaticParam(words[i], `data${params.length}`));
      }
    }

    return params;
  }

  function hasUsefulDynamicEventParams(params) {
    return params.some(param => param.type === 'string' || param.type === 'bytes' || /\[\]$/.test(param.type));
  }

  function inferDataParams(dataHex) {
    const eventHeadTailParams = inferEventHeadTailParams(dataHex);
    if (eventHeadTailParams.length > 0 && hasUsefulDynamicEventParams(eventHeadTailParams)) {
      return eventHeadTailParams;
    }

    const guessed = tryGuessABIStructure(dataHex);
    if (guessed && guessed.length > 0) return guessed;

    return eventHeadTailParams;
  }

  function hiddenValue(uiDocument, id) {
    const element = uiDocument.getElementById(id);
    return element?.value || element?.textContent || '';
  }

  function extractTopics(eventNumber, list, uiDocument) {
    const topics = [];
    for (let i = 0; i < 4; i++) {
      const fromHidden = normalizeHex(hiddenValue(uiDocument, `topic${i}_hiddenField_${eventNumber}`));
      if (fromHidden.length === 66) topics.push(fromHidden);
    }
    if (topics.length) return topics;

    const matches = (list?.textContent || '').match(/0x[0-9a-fA-F]{64}/g) || [];
    return matches.filter((topic, index, all) => all.indexOf(topic) === index).slice(0, 4);
  }

  function extractLog(rawEntry, uiDocument) {
    const { element, eventNumber } = rawEntry;
    const list = element.closest('ul.log-detail, ul.list-unstyled, ul');
    if (!eventNumber || !list) return null;

    return {
      eventNumber,
      list,
      topics: extractTopics(eventNumber, list, uiDocument),
      data: cleanHexText(element.textContent || element.value || '')
    };
  }

  function getNativeViewControls(log) {
    const rawRows = log.list.ownerDocument.getElementById(`event_raw_data_${log.eventNumber}`);
    const scopes = [
      log.list,
      rawRows?.parentElement,
      rawRows?.closest('dd'),
    ].filter(Boolean);

    const controls = [];
    scopes.forEach(scope => {
      scope.querySelectorAll('button, a, label, input, [role="button"], .btn').forEach(control => {
        if (!controls.includes(control)) controls.push(control);
      });
    });

    return controls.map(control => ({
      control,
      text: (control.textContent || control.value || control.getAttribute('aria-label') || '').trim().toLowerCase(),
      onclick: (control.getAttribute('onclick') || '').toLowerCase(),
      target: (control.getAttribute('data-bs-target') || control.getAttribute('data-target') || '').toLowerCase()
    }));
  }

  function findNativeAbiControl(log) {
    return getNativeViewControls(log).find(({ text, onclick, target }) => (
      text === 'abi' ||
      /\babi\b/.test(text) ||
      onclick.includes('decodeevent') ||
      target.includes('abi')
    ))?.control || null;
  }

  function hasNativeAbiOption(log) {
    if (findNativeAbiControl(log)) return true;
    return /decodeevent\s*\(|>\s*abi\s*</i.test(log.list.outerHTML || '');
  }

  function hasNativeEventName(log, uiDocument) {
    const hiddenName = hiddenValue(uiDocument, `eventName_hiddenField_${log.eventNumber}`).trim();
    if (hiddenName && !/^unknown/i.test(hiddenName)) return true;

    const eventBody = log.list.closest('.flex-grow-1') || log.list.closest('.flex-shrink-1');
    if (!eventBody) return false;

    return Array.from(eventBody.querySelectorAll('dl')).some(row => {
      const label = (row.querySelector('dt')?.textContent || '').trim().toLowerCase();
      if (label !== 'name') return false;

      const value = (row.querySelector('dd')?.textContent || '')
        .replace(/\bview\b/ig, '')
        .replace(/\bsource\b/ig, '')
        .trim();
      return value.length > 0;
    });
  }

  function ensurePageBridge() {
    if (bridgeLoaded) return;
    if (document.getElementById(BRIDGE_ID)) return;

    const script = document.createElement('script');
    script.id = BRIDGE_ID;
    script.src = chrome.runtime.getURL('event-log-decoder/event_log_view_bridge.js');
    script.onload = () => {
      bridgeLoaded = true;
      while (bridgeQueue.length) {
        const queuedDispatch = bridgeQueue.shift();
        queuedDispatch();
      }
      script.remove();
    };
    script.onerror = () => {
      console.warn('[event_log_decoder] failed to load event log view bridge');
    };

    (document.head || document.documentElement).appendChild(script);
  }

  function dispatchNativeViewRequest(eventNumber, mode) {
    const dispatch = () => {
      window.dispatchEvent(new CustomEvent(VIEW_EVENT_NAME, {
        detail: { eventNumber, mode }
      }));
    };

    ensurePageBridge();
    if (bridgeLoaded) {
      dispatch();
    } else {
      bridgeQueue.push(dispatch);
    }
  }

  function markNativeAbiActive(log) {
    getNativeViewControls(log).forEach(({ control, text, onclick, target }) => {
      const isAbi = text === 'abi' || /\babi\b/.test(text) || onclick.includes('decodeevent') || target.includes('abi');
      const isView = isAbi || text === 'dec' || text === 'hex' || onclick.includes('converteventdata');
      if (!isView) return;

      control.classList.toggle('active', isAbi);
      control.classList.toggle('btn-secondary', isAbi);
      control.classList.toggle('btn-white', !isAbi);
      control.setAttribute('aria-pressed', isAbi ? 'true' : 'false');
    });
  }

  function defaultNativeAbiView(log, uiDocument) {
    log.list.dataset.evmoleNativeAbiDefault = 'true';
    markNativeAbiActive(log);

    if (uiDocument !== document) return;

    dispatchNativeViewRequest(log.eventNumber, 'abi');
  }

  function formatConvertedValue(rawValue, mode) {
    const hex = normalizeHex(rawValue);

    if (mode === 'hex') return hex;

    if (mode === 'number') {
      const value = safeBigInt(hex);
      return value === null ? 'N/A' : value.toString();
    }

    if (mode === 'text') return tryUtf8(hex) || 'N/A';
    if (mode === 'address') return byteLength(hex) >= 20 ? wordToAddress(hex) : 'N/A';
    return String(rawValue ?? '');
  }

  function defaultConvertMode(type) {
    if (type === 'address') return 'address';
    if (type === 'string') return 'text';
    if (type === 'bool' || type.startsWith('uint') || type.startsWith('int')) return 'number';
    return 'hex';
  }

  function valueClass(type) {
    if (type === 'address') return 'text-primary';
    if (type === 'string') return 'text-light';
    if (type === 'bool' || type.startsWith('uint') || type.startsWith('int')) return 'text-info';
    return 'text-danger';
  }

  function renderParamValue(param) {
    if (param.type === 'address') {
      const addressUrl = getExplorerAddressUrl(param.value);
      if (addressUrl) {
        return `<a class="${valueClass(param.type)} evmole-event-value" href="${addressUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(param.value)}</a>`;
      }
    }

    return `<span class="${valueClass(param.type)} evmole-event-value">${escapeHtml(param.value)}</span>`;
  }

  function renderParam(param, index) {
    const mode = defaultConvertMode(param.type);
    return `
      <div class="evmole-event-param mb-2" data-evmole-raw-value="${escapeHtml(param.rawValue)}">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
          <span class="text-muted">[${index}]</span>
          <span class="badge bg-secondary">${escapeHtml(param.type)}${param.indexed ? ' indexed' : ''}</span>
          <span class="text-muted">${escapeHtml(param.name)}</span>
        </div>
        <div class="d-flex flex-wrap align-items-center gap-2 ms-4">
          <select class="form-select form-select-sm w-auto evmole-event-convert">
            <option value="hex"${mode === 'hex' ? ' selected' : ''}>Hex</option>
            <option value="number"${mode === 'number' ? ' selected' : ''}>Number</option>
            <option value="text"${mode === 'text' ? ' selected' : ''}>Text</option>
            <option value="address"${mode === 'address' ? ' selected' : ''}>Address</option>
          </select>
          ${renderParamValue(param)}
        </div>
      </div>
    `;
  }

  function renderDecodedUi(log) {
    const indexedParams = log.topics.slice(1).map((topic, index) => inferTopicParam(topic, index + 1));
    const dataParams = inferDataParams(log.data);
    const params = [...indexedParams, ...dataParams];
    const signature = `unknown_event(${params.map(param => param.indexed ? `${param.type} indexed` : param.type).join(',')})`;

    return `
      <div class="evmole-event-log-decoded border rounded p-3 mt-2">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span class="badge bg-warning text-dark">Evmole: ${escapeHtml(signature)}</span>
          <span class="text-muted">inferred ABI layout</span>
        </div>
        <div class="evmole-event-param-list">
          ${params.map(renderParam).join('')}
        </div>
      </div>
    `;
  }

  function attachConvertListeners(root = document) {
    root.querySelectorAll('.evmole-event-convert').forEach(select => {
      if (select.dataset.evmoleConvertWired === 'true') return;
      select.dataset.evmoleConvertWired = 'true';
      select.addEventListener('change', () => {
        const row = select.closest('[data-evmole-raw-value]');
        const value = row?.querySelector('.evmole-event-value');
        if (!row || !value) return;
        value.textContent = formatConvertedValue(row.dataset.evmoleRawValue || '0x', select.value);
      });
    });
  }

  function ensureDecodedContainer(log, uiDocument) {
    let container = uiDocument.getElementById(`evmole_event_decoded_${log.eventNumber}`);
    if (container) return container;

    container = uiDocument.createElement('div');
    container.id = `evmole_event_decoded_${log.eventNumber}`;
    container.className = 'evmole-event-decoded-container';

    const rawRows = uiDocument.getElementById(`event_raw_data_${log.eventNumber}`);
    const decRows = uiDocument.getElementById(`event_dec_data_${log.eventNumber}`);
    const nativeAbiRows = uiDocument.getElementById(`event_achoc_${log.eventNumber}`);
    const anchor = nativeAbiRows || decRows || rawRows;

    if (anchor) {
      anchor.insertAdjacentElement('afterend', container);
    } else {
      log.list.appendChild(container);
    }

    return container;
  }

  function showDecodedOnly(log, uiDocument) {
    const rawRows = uiDocument.getElementById(`event_raw_data_${log.eventNumber}`);
    const decRows = uiDocument.getElementById(`event_dec_data_${log.eventNumber}`);
    const nativeAbiRows = uiDocument.getElementById(`event_achoc_${log.eventNumber}`);
    const decodedRows = uiDocument.getElementById(`evmole_event_decoded_${log.eventNumber}`);

    if (rawRows) rawRows.style.display = 'none';
    if (decRows) decRows.style.display = 'none';
    if (nativeAbiRows) nativeAbiRows.style.display = 'none';
    if (decodedRows) decodedRows.style.display = '';
  }

  function renderLogDecode(rawEntry, uiDocument = document) {
    const log = extractLog(rawEntry, uiDocument);
    if (!log || (!log.topics.length && byteLength(log.data) === 0)) return;

    if (hasNativeAbiOption(log)) {
      defaultNativeAbiView(log, uiDocument);
      return;
    }

    if (hasNativeEventName(log, uiDocument)) return;

    const container = ensureDecodedContainer(log, uiDocument);
    if (!container.querySelector('.evmole-event-log-decoded')) {
      container.innerHTML = renderDecodedUi(log);
      attachConvertListeners(container);
    }
    showDecodedOnly(log, uiDocument);
  }

  async function prepareEventLogPaneFromHtml(txHash, attemptKey) {
    if (prefetchInFlight || prefetchedAttemptKey === attemptKey) return;
    prefetchInFlight = true;

    try {
      const url = `${window.location.origin}/tx/${txHash}`;
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
      const parsedEntries = getRawDataElements(parsedDocument);
      if (parsedEntries.length === 0 || parsedEntries.length > MAX_LOGS_TO_RENDER) return;

      parsedEntries.forEach(entry => renderLogDecode(entry, parsedDocument));

      const parsedPane = parsedDocument.getElementById('eventlog-tab-content');
      if (!parsedPane) return;

      prefetchedEventLogPaneHtml = parsedPane.innerHTML;
      prefetchedAttemptKey = attemptKey;
      applyPrefetchedEventLogPane();
    } catch (error) {
      console.warn('[event_log_decoder] background eventlog predecode failed:', error);
    } finally {
      prefetchInFlight = false;
    }
  }

  function applyPrefetchedEventLogPane() {
    if (!prefetchedEventLogPaneHtml) return false;

    const livePane = document.getElementById('eventlog-tab-content');
    if (!livePane || livePane.dataset.evmolePrefetchedEventlog === 'true') return false;

    livePane.innerHTML = prefetchedEventLogPaneHtml;
    livePane.dataset.evmolePrefetchedEventlog = 'true';
    attachConvertListeners(livePane);
    getRawDataElements(livePane).forEach(entry => {
      const log = extractLog(entry, document);
      if (log && hasNativeAbiOption(log)) defaultNativeAbiView(log, document);
    });
    return true;
  }

  async function injectEventLogDecoder() {
    if (renderInFlight) return;

    const txHash = getTxHashFromPath();
    if (!txHash) return;

    if (applyPrefetchedEventLogPane()) return;

    const rawEntries = getRawDataElements();
    if (rawEntries.length > MAX_LOGS_TO_RENDER) return;

    const attemptKey = `${txHash}:${rawEntries.map(entry => entry.eventNumber).join(',')}`;
    if (attemptKey === lastAttemptKey) return;

    if (rawEntries.length === 0) {
      await prepareEventLogPaneFromHtml(txHash, `${txHash}:prefetch`);
      return;
    }

    renderInFlight = true;
    try {
      rawEntries.forEach(entry => renderLogDecode(entry));
      lastAttemptKey = attemptKey;
    } catch (error) {
      console.error('[event_log_decoder] event log decode failed:', error);
    } finally {
      renderInFlight = false;
    }
  }

  function scheduleApply() {
    if (applyTimer) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(() => {
      applyTimer = null;
      injectEventLogDecoder();
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleApply);
  } else {
    scheduleApply();
  }

  const observer = new MutationObserver(() => {
    if (applyPrefetchedEventLogPane() || document.querySelector(RAW_DATA_SELECTOR)) {
      scheduleApply();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
