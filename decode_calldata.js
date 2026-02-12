// Calldata decoder for Etherscan tx pages
(function() {
  console.log('[decode_calldata] loaded adapter build v2');
  // Prevent duplicate decode calls
  let isDecoding = false;
  let nestedDecodeCount = 0; // Track nested decodes to only auto-expand first
  const pendingAutoExpand = {}; // Store calldata for auto-expand by ID

  // Unit conversion options
  const UNIT_OPTIONS = [
    { label: 'Wei', decimals: 0 },
    { label: 'Gwei', decimals: 9 },
    { label: 'ETH', decimals: 18 },
    { label: '10^6', decimals: 6 },
  ];

  // Auto-expand collapsed content
  function expandCollapse() {
    const el = document.getElementById('ContentPlaceHolder1_collapseContent');
    if (el && !el.classList.contains('show')) {
      el.classList.add('show');
    }
  }
  expandCollapse();
  const observer = new MutationObserver(expandCollapse);
  observer.observe(document.body, { childList: true, subtree: true });

  // Common function selectors
  const KNOWN_SELECTORS = {
    '0xa9059cbb': 'transfer(address,uint256)',
    '0x095ea7b3': 'approve(address,uint256)',
    '0x23b872dd': 'transferFrom(address,address,uint256)',
    '0x70a08231': 'balanceOf(address)',
    '0xdd62ed3e': 'allowance(address,address)',
    '0x40c10f19': 'mint(address,uint256)',
    '0x42966c68': 'burn(uint256)',
    '0x42842e0e': 'safeTransferFrom(address,address,uint256)',
    '0xb88d4fde': 'safeTransferFrom(address,address,uint256,bytes)',
    '0x6352211e': 'ownerOf(uint256)',
    '0x081812fc': 'getApproved(uint256)',
    '0xa22cb465': 'setApprovalForAll(address,bool)',
    '0x3659cfe6': 'upgradeTo(address)',
    '0x4f1ef286': 'upgradeToAndCall(address,bytes)',
    '0x8b95dd71': 'setRecord(bytes32,address,uint64,uint64)',
    '0x1fad948c': 'handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[],address)',
    '0xf242432a': 'safeTransferFrom(address,address,uint256,uint256,bytes)',
    '0x2eb2c2d6': 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
    '0x38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    '0x7ff36ab5': 'swapExactETHForTokens(uint256,address[],address,uint256)',
    '0x18cbafe5': 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
    '0xfb3bdb41': 'swapETHForExactTokens(uint256,address[],address,uint256)',
    '0x5c11d795': 'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
    '0xc04b8d59': 'exactInput((bytes,address,uint256,uint256,uint256))',
    '0x414bf389': 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
    '0xdb3e2198': 'exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
    '0x3593564c': 'execute(bytes,bytes[],uint256)',
    '0x24856bc3': 'execute(bytes,bytes[])',
    '0x765e827f': 'handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)',
    '0xe9ae5c53': 'execute(bytes32,bytes)',
    '0x882db707': 'create((uint256,uint256,address,address,bytes,address,bytes,address,bytes,address,bytes,address,bytes32))',
    '0xac9650d8': 'multicall(bytes[])',
    '0x5ae401dc': 'multicall(uint256,bytes[])',
    '0x1f0464d1': 'multicall(bytes32,bytes[])',
    '0x8803dbee': 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)',
    '0xbc1b0ead': 'createToken(string,string,string,string,string,string)'
  };

  // Adapter registry for protocol-specific decoding paths.
  // Each adapter can override generic ABI recursion when a selector/context
  // requires non-standard layout handling.
  const DECODE_ADAPTERS = [];

  function registerDecodeAdapter(adapter) {
    if (!adapter || typeof adapter.id !== 'string' || typeof adapter.decode !== 'function') return;
    DECODE_ADAPTERS.push(adapter);
  }

  // Fetch function signature from APIs
  async function fetchSignature(selector) {
    // Skip zero selector - common in raw data, causes false positives
    if (selector === '0x00000000') {
      return null;
    }

    // Check local cache first
    if (KNOWN_SELECTORS[selector]) {
      return KNOWN_SELECTORS[selector];
    }

    try {
      // Try OpenChain first
      const ocUrl = `https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}`;
      const ocResp = await fetch(ocUrl);
      if (ocResp.ok) {
        const data = await ocResp.json();
        if (data.ok && data.result?.function?.[selector]?.length > 0) {
          const results = data.result.function[selector];
          const sig = results.find(r => !r.filtered) || results[0];
          return sig.name;
        }
      }
    } catch (e) {}

    try {
      // Fallback to 4byte
      const fbUrl = `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`;
      const fbResp = await fetch(fbUrl);
      if (fbResp.ok) {
        const data = await fbResp.json();
        if (data.results?.length > 0) {
          return data.results[0].text_signature;
        }
      }
    } catch (e) {}

    return null;
  }

  // Hex utilities
  function slice(hex, start, end) {
    const s = 2 + start * 2;
    const e = end ? 2 + end * 2 : undefined;
    return '0x' + hex.slice(s, e);
  }

  function hexToBytes(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return bytes;
  }

  function hexToString(hex) {
    return new TextDecoder().decode(hexToBytes(hex));
  }

  function isValidUtf8(hex) {
    try {
      const str = hexToString(hex);
      const printable = str.split('').filter(c => {
        const code = c.charCodeAt(0);
        return code >= 32 && code <= 126;
      }).length;
      return printable / str.length > 0.7;
    } catch { return false; }
  }

  // Unit conversion functions
  function convertWeiToUnit(weiStr, decimals) {
    if (!weiStr || weiStr === '0') return '0';
    try {
      const wei = BigInt(weiStr);
      if (decimals === 0) return wei.toString();
      const divisor = 10n ** BigInt(decimals);
      const whole = wei / divisor;
      const remainder = wei % divisor;
      if (remainder === 0n) return whole.toString();
      const remainderStr = remainder.toString().padStart(decimals, '0');
      const trimmed = remainderStr.replace(/0+$/, '');
      return `${whole}.${trimmed}`;
    } catch { return weiStr; }
  }

  function formatWithCommas(numStr) {
    const str = String(numStr);
    const [whole, decimal] = str.split('.');
    const formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimal ? `${formatted}.${decimal}` : formatted;
  }

  // Check if bytes could be valid calldata (has non-zero selector)
  function couldBeCalldata(hex) {
    if (!hex || typeof hex !== 'string') return false;
    const clean = hex.startsWith('0x') ? hex : '0x' + hex;
    if (clean.length < 10 || !/^0x[0-9a-fA-F]+$/.test(clean)) return false;
    // Require non-zero selector - 0x00000000 is likely raw data, not calldata
    const selector = clean.slice(0, 10);
    return selector !== '0x00000000';
  }

  function isHex(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);
  }

  function safeBigInt(hex) {
    if (!isHex(hex) || hex.length <= 2) return null;
    try {
      return BigInt(hex);
    } catch {
      return null;
    }
  }

  function tryParsePackedExecutionData(executionData) {
    if (!isHex(executionData)) return null;
    const clean = executionData.slice(2);
    // target(20 bytes) + value(32 bytes) = 52 bytes = 104 hex chars minimum
    if (clean.length < 104) return null;
    const target = '0x' + clean.slice(0, 40);
    const valueBig = safeBigInt('0x' + clean.slice(40, 104));
    if (valueBig === null) return null;
    const inner = '0x' + clean.slice(104);
    return {
      target,
      value: valueBig.toString(),
      data: inner
    };
  }

  async function tryDecodeWithAdapters(calldata, selector) {
    for (const adapter of DECODE_ADAPTERS) {
      try {
        if (typeof adapter.match === 'function' && !adapter.match({ calldata, selector })) {
          continue;
        }
        const decoded = await adapter.decode({ calldata, selector });
        if (decoded && !decoded.error) {
          console.log('[decode_calldata] adapter matched:', adapter.id, 'selector:', selector);
          return {
            selector: decoded.selector || selector,
            signature: decoded.signature || null,
            funcName: decoded.funcName || null,
            params: Array.isArray(decoded.params) ? decoded.params : [],
            adapter: adapter.id
          };
        }
      } catch (e) {
        // Adapter failures should not break global decode flow.
      }
    }
    return null;
  }

  // Parse ABI types from signature - handles nested parens
  function parseSignatureTypes(sig) {
    // Find outermost parentheses
    const start = sig.indexOf('(');
    if (start === -1) return [];

    // Find matching closing paren
    let depth = 0;
    let end = -1;
    for (let i = start; i < sig.length; i++) {
      if (sig[i] === '(') depth++;
      else if (sig[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return [];

    const inner = sig.slice(start + 1, end);
    if (!inner) return [];

    // Parse comma-separated types, respecting nested parens
    const types = [];
    depth = 0;
    let current = '';
    for (const char of inner) {
      if (char === '(') depth++;
      else if (char === ')') depth--;
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

  // Check if type is dynamic (needs pointer)
  function isDynamicType(type) {
    if (type === 'bytes' || type === 'string') return true;
    if (type.endsWith('[]')) return true;
    if (type.startsWith('(')) {
      const inner = parseSignatureTypes(type);
      return inner.some(t => isDynamicType(t));
    }
    return false;
  }

  // Infer type from value
  function inferType(value) {
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'string') {
      if (value.startsWith('0x')) {
        // Check if it's an address (42 chars) or bytes
        if (value.length === 42) return 'address';
        if (value.length === 66) return 'bytes32';
        return 'bytes';
      }
      // Numeric string
      return 'uint256';
    }
    if (typeof value === 'number' || typeof value === 'bigint') return 'uint256';
    if (Array.isArray(value)) return 'tuple';
    return 'bytes';
  }

  // Decode based on ABI type
  function decodeParam(data, offset, type) {
    // Check bounds
    const dataLen = (data.length - 2) / 2;
    if (offset >= dataLen) {
      return { value: 'N/A', len: 32, type };
    }
    const word = slice(data, offset, offset + 32);
    if (word.length < 6) { // "0x" + at least some data
      return { value: 'N/A', len: 32, type };
    }
    // Pad if shorter than 32 bytes
    const paddedWord = word.length < 66 ? word.padEnd(66, '0') : word;
    const wordVal = BigInt(paddedWord);

    if (type === 'address') {
      return { value: '0x' + paddedWord.slice(26), len: 32, type: 'address' };
    }
    if (type === 'bool') {
      return { value: wordVal === 1n, len: 32, type: 'bool' };
    }
    if (type.startsWith('uint')) {
      return { value: wordVal.toString(), len: 32, type };
    }
    if (type.startsWith('int')) {
      const bits = parseInt(type.slice(3)) || 256;
      const max = 1n << BigInt(bits);
      const signed = wordVal >= (max >> 1n) ? wordVal - max : wordVal;
      return { value: signed.toString(), len: 32, type };
    }
    if (type === 'bytes32') {
      return { value: word, len: 32, type: 'bytes32' };
    }
    if (type === 'string' || type === 'bytes') {
      // It's a pointer to dynamic data
      const ptr = Number(wordVal);
      return decodeDynamic(data, ptr, type);
    }
    if (type.endsWith('[]')) {
      const ptr = Number(wordVal);
      return decodeArray(data, ptr, type.slice(0, -2));
    }
    if (type.startsWith('(')) {
      // Check if tuple is static or dynamic
      if (isDynamicType(type)) {
        // Dynamic tuple - pointer to tuple data
        const ptr = Number(wordVal);
        return decodeTuple(data, ptr, type);
      } else {
        // Static tuple - decode inline from current offset
        return decodeTupleInline(data, offset, type);
      }
    }

    // Default: return as uint256
    return { value: wordVal.toString(), len: 32, type: 'uint256' };
  }

  function decodeDynamic(data, ptr, type) {
    try {
      const lenWord = slice(data, ptr, ptr + 32);
      const lenBig = safeBigInt(lenWord);
      if (lenBig === null) return { value: 'invalid', len: 32, type };
      const len = Number(lenBig);
      if (len === 0) {
        return { value: type === 'string' ? '' : '0x', len: 32, type };
      }
      if (len < 0 || ptr + 32 + len > (data.length - 2) / 2) {
        return { value: 'invalid', len: 32, type };
      }
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
        // Dynamic elements: each slot contains offset relative to array data start
        const arrayDataStart = ptr + 32;
        for (let i = 0; i < len && i < 20; i++) {
          const offsetWord = slice(data, arrayDataStart + i * 32, arrayDataStart + (i + 1) * 32);
          const elemOffsetBig = safeBigInt(offsetWord);
          if (elemOffsetBig === null) break;
          const elemOffset = Number(elemOffsetBig);
          const elemPtr = arrayDataStart + elemOffset;

          if (elemType.startsWith('(')) {
            // Dynamic tuple - decode at pointer location
            const elem = decodeTuple(data, elemPtr, elemType);
            elements.push(elem.value);
          } else {
            // bytes/string
            const elem = decodeDynamic(data, elemPtr, elemType);
            elements.push(elem.value);
          }
        }
      } else {
        // Static elements: encoded sequentially
        let curOffset = ptr + 32;
        for (let i = 0; i < len && i < 20; i++) {
          const elem = decodeParam(data, curOffset, elemType);
          elements.push(elem.value);
          curOffset += elem.len;
        }
      }
      return { value: elements, len: 32, type: `${elemType}[]` };
    } catch (e) {
      console.error('Array decode error:', e);
      return { value: [], len: 32, type: `${elemType}[]` };
    }
  }

  // Decode static tuple inline (no pointer dereference)
  function decodeTupleInline(data, offset, type) {
    try {
      const types = parseSignatureTypes(type);
      const values = [];
      let curOffset = offset;
      const dataLen = (data.length - 2) / 2;

      for (const t of types) {
        if (curOffset >= dataLen) break;
        const res = decodeParam(data, curOffset, t);
        values.push(res.value);
        curOffset += res.len;
      }
      // Total length is sum of all field lengths
      return { value: values, len: curOffset - offset, type: 'tuple' };
    } catch {
      return { value: [], len: 32, type: 'tuple' };
    }
  }

  // Decode dynamic tuple via pointer
  function decodeTuple(data, ptr, type) {
    try {
      const types = parseSignatureTypes(type);
      const values = [];
      const dataLen = (data.length - 2) / 2;

      // For tuples with dynamic types, first read all head values (either direct values or offsets)
      // Then resolve dynamic types using their offsets relative to tuple start
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        const headOffset = ptr + i * 32;
        if (headOffset >= dataLen) break;

        if (isDynamicType(t)) {
          // Read offset and resolve
          const offsetWord = slice(data, headOffset, headOffset + 32);
          const offsetBig = safeBigInt(offsetWord);
          if (offsetBig === null) {
            values.push('N/A');
            continue;
          }
          const offset = Number(offsetBig);
          const actualPtr = ptr + offset;

          if (t === 'bytes' || t === 'string') {
            const res = decodeDynamic(data, actualPtr, t);
            values.push(res.value);
          } else if (t.endsWith('[]')) {
            const res = decodeArray(data, actualPtr, t.slice(0, -2));
            values.push(res.value);
          } else if (t.startsWith('(')) {
            const res = decodeTuple(data, actualPtr, t);
            values.push(res.value);
          } else {
            values.push('N/A');
          }
        } else {
          // Static type - decode directly
          const res = decodeParam(data, headOffset, t);
          values.push(res.value);
        }
      }
      return { value: values, len: 32, type: 'tuple' };
    } catch (e) {
      console.error('Tuple decode error:', e);
      return { value: [], len: 32, type: 'tuple' };
    }
  }

  // Heuristic decode without ABI
  function analyzeWord(word, offset, fullData) {
    const wordVal = BigInt(word);
    const dataLen = (fullData.length - 2) / 2;

    // Address check (12 zero bytes + 20 byte addr)
    if (word.slice(0, 26) === '0x000000000000000000000000') {
      const addrPart = word.slice(26);
      if (addrPart !== '0'.repeat(40)) {
        const leadingZeros = addrPart.match(/^0*/)?.[0].length || 0;
        if (leadingZeros <= 20) {
          return { type: 'address', value: '0x' + addrPart };
        }
      }
    }

    // Boolean
    if (wordVal === 0n || wordVal === 1n) {
      return { type: 'bool', value: wordVal === 1n };
    }

    // Dynamic pointer
    const possiblePtr = Number(wordVal);
    if (possiblePtr > 0 && possiblePtr < dataLen && possiblePtr % 32 === 0) {
      try {
        const lenWord = slice(fullData, possiblePtr, possiblePtr + 32);
        const lenBig = safeBigInt(lenWord);
        if (lenBig === null) return { type: 'offset', value: possiblePtr };
        const len = Number(lenBig);

        // Check if this looks like a bytes[] array (len is small, followed by offsets)
        if (len > 0 && len <= 50 && possiblePtr + 32 + len * 32 <= dataLen) {
          // Check if next values look like offsets (multiples of 32, pointing within data)
          const firstOffsetBig = safeBigInt(slice(fullData, possiblePtr + 32, possiblePtr + 64));
          if (firstOffsetBig === null) return { type: 'offset', value: possiblePtr };
          const firstOffset = Number(firstOffsetBig);
          if (firstOffset > 0 && firstOffset % 32 === 0 && firstOffset < dataLen) {
            // Likely a bytes[] array - try to decode elements
            const elements = [];
            const arrayDataStart = possiblePtr + 32;
            let isValidArray = true;

            for (let i = 0; i < len && i < 20; i++) {
              const elemOffsetWord = slice(fullData, arrayDataStart + i * 32, arrayDataStart + (i + 1) * 32);
              const elemOffsetBig = safeBigInt(elemOffsetWord);
              if (elemOffsetBig === null) { isValidArray = false; break; }
              const elemOffset = Number(elemOffsetBig);
              const elemPtr = arrayDataStart + elemOffset;

              if (elemPtr >= dataLen) { isValidArray = false; break; }

              // Read bytes length at element pointer
              const bytesLenWord = slice(fullData, elemPtr, elemPtr + 32);
              const bytesLenBig = safeBigInt(bytesLenWord);
              if (bytesLenBig === null) { isValidArray = false; break; }
              const bytesLen = Number(bytesLenBig);

              if (bytesLen <= 0 || bytesLen > 10000 || elemPtr + 32 + bytesLen > dataLen) {
                isValidArray = false; break;
              }

              const content = slice(fullData, elemPtr + 32, elemPtr + 32 + bytesLen);
              elements.push(content);
            }

            if (isValidArray && elements.length > 0) {
              // Calculate end of array data for range tracking
              const lastElemOffsetBig = safeBigInt(slice(fullData, arrayDataStart + (len - 1) * 32, arrayDataStart + len * 32));
              if (lastElemOffsetBig === null) return { type: 'bytes[]', value: elements, ptr: possiblePtr };
              const lastElemOffset = Number(lastElemOffsetBig);
              const lastElemPtr = arrayDataStart + lastElemOffset;
              const lastBytesLenBig = safeBigInt(slice(fullData, lastElemPtr, lastElemPtr + 32));
              if (lastBytesLenBig === null) return { type: 'bytes[]', value: elements, ptr: possiblePtr };
              const lastBytesLen = Number(lastBytesLenBig);
              const endOffset = lastElemPtr + 32 + Math.ceil(lastBytesLen / 32) * 32;
              return { type: 'bytes[]', value: elements, ptr: possiblePtr, endOffset };
            }
          }
        }

        // Try to decode as simple string/bytes
        if (len > 0 && len < 10000 && possiblePtr + 32 + len <= dataLen) {
          const content = slice(fullData, possiblePtr + 32, possiblePtr + 32 + len);
          const endOffset = possiblePtr + 32 + Math.ceil(len / 32) * 32;
          if (isValidUtf8(content)) {
            return { type: 'string', value: hexToString(content), ptr: possiblePtr, endOffset };
          }
          return { type: 'bytes', value: content, ptr: possiblePtr, endOffset };
        }
      } catch {}
      return { type: 'offset', value: possiblePtr };
    }

    // Small numbers
    if (wordVal < 256n) return { type: 'uint8', value: Number(wordVal) };
    if (wordVal < 65536n) return { type: 'uint16', value: Number(wordVal) };

    // Timestamp check
    if (wordVal >= 1000000000n && wordVal <= 2000000000n) {
      return { type: 'timestamp', value: wordVal.toString() };
    }

    return { type: 'uint256', value: wordVal.toString() };
  }

  // ---------------------------------------------------------------------------
  // ABI structure guesser – ported from @openchainxyz/abi-guesser (MIT, samczsun)
  // Uses backtracking DFS to infer ABI types from raw calldata.
  // Adapted to work without ethers.js: lightweight PType shim replaces ParamType,
  // existing decodeParam() chain validates guessed types.
  // ---------------------------------------------------------------------------

  // Lightweight ParamType replacement
  class PType {
    constructor(typeStr) {
      this.type = typeStr;
      this._baseType = null;
      this._components = null;
      this._arrayChildren = null;
      this._parse();
    }
    _parse() {
      const t = this.type;
      if (t.endsWith('[]')) {
        this._baseType = 'array';
        this._arrayChildren = PType.from(t.slice(0, -2));
      } else if (t.startsWith('(') && t.endsWith(')')) {
        this._baseType = 'tuple';
        const inner = t.slice(1, -1);
        if (!inner) { this._components = []; return; }
        // Parse comma-separated types respecting nested parens
        const parts = [];
        let depth = 0, cur = '';
        for (const ch of inner) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
          else cur += ch;
        }
        if (cur.trim()) parts.push(cur.trim());
        this._components = parts.map(p => PType.from(p));
      } else {
        this._baseType = t;
      }
    }
    get baseType() { return this._baseType; }
    get components() { return this._components || []; }
    get arrayChildren() { return this._arrayChildren; }
    isTuple() { return this._baseType === 'tuple'; }
    isArray() { return this._baseType === 'array'; }
    format() { return this.type; }
    static from(typeStr) { return new PType(typeStr); }
    static isParamType(v) { return v instanceof PType; }
  }

  // Byte-level helpers for the guesser (works on Uint8Array)
  function gEncodeHex(data) {
    const lut = [];
    for (let i = 0; i < 256; i++) lut[i] = i.toString(16).padStart(2, '0');
    const parts = new Array(data.length);
    for (let i = 0; i < data.length; i++) parts[i] = lut[data[i]];
    return '0x' + parts.join('');
  }

  function gDecodeHex(hex) {
    const s = (typeof hex === 'string' && hex.startsWith('0x')) ? hex.slice(2) : hex;
    if (typeof s !== 'string') return s; // already Uint8Array
    const arr = new Uint8Array(s.length / 2);
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return arr;
  }

  function gIsSafe(val) { return val < BigInt(Number.MAX_SAFE_INTEGER); }

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

  function gCountLeadingZeros(arr) {
    let c = 0;
    for (let i = 0; i < arr.length; i++) { if (arr[i] !== 0) break; c++; }
    return c;
  }

  function gCountTrailingZeros(arr) {
    let c = 0;
    for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] !== 0) break; c++; }
    return c;
  }

  function gFormatParams(params) {
    return params.map(v => v.format()).join(',');
  }

  function gGenerateConsistentResult(params) {
    if (params.length === 0) return null;
    if (params[0].isTuple() && params[0].components.length > 0) {
      if (params.find(v => !v.isTuple())) return null;
      if (new Set(params.map(v => v.components.length)).size !== 1) return null;
      const components = [];
      for (let i = 0; i < params[0].components.length; i++) {
        const c = gGenerateConsistentResult(params.map(v => v.components[i]));
        if (!c) return null;
        components.push(c);
      }
      return PType.from('(' + gFormatParams(components) + ')');
    }
    if (params[0].isArray()) {
      if (params.find(v => !v.isArray())) return null;
      const ac = gGenerateConsistentResult(params.map(v => v.arrayChildren));
      if (!ac) return null;
      return PType.from(ac.format() + '[]');
    }
    const checker = new Set();
    for (const p of params) {
      let v = p.format();
      if (v === '()[]') v = 'bytes';
      checker.add(v);
    }
    if (checker.size !== 1) return null;
    return PType.from(checker.values().next().value);
  }

  // Validate guessed types by attempting decode with existing decodeParam chain
  function gTestParams(params, data) {
    if (!params) return false;
    try {
      const hex = '0x' + Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
      let offset = 0;
      for (const p of params) {
        const res = decodeParam(hex, offset, p.format());
        if (res.value === 'N/A' || res.value === 'decode error') return false;
        offset += res.len;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Decode values for type inference using existing decodeParam chain
  function gDecodeValues(params, data) {
    const hex = '0x' + Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
    const vals = [];
    let offset = 0;
    for (const p of params) {
      const res = decodeParam(hex, offset, p.format());
      vals.push(res.value);
      offset += res.len;
    }
    return vals;
  }

  // Core backtracking DFS – ported from @openchainxyz/abi-guesser
  function decodeWellFormedTuple(depth, data, paramIdx, collectedParams, endOfStaticCalldata, expectedLength, isDynamicArrayElement) {
    const testParams = (params) => gTestParams(params, data);

    const paramOffset = paramIdx * 32;

    if (paramOffset < endOfStaticCalldata) {
      // Still in static region – determine next param and recurse
      const maybeOffset = gTryParseOffset(data, paramOffset);
      if (maybeOffset !== null) {
        const maybeLength = gTryParseLength(data, maybeOffset);

        if (maybeLength !== null && (isDynamicArrayElement === null || isDynamicArrayElement === true)) {
          const fragment = decodeWellFormedTuple(
            depth, data, paramIdx + 1,
            [...collectedParams, { offset: maybeOffset, length: maybeLength }],
            Math.min(endOfStaticCalldata, maybeOffset),
            expectedLength, isDynamicArrayElement
          );
          if (testParams(fragment)) return fragment;
        }

        if (isDynamicArrayElement === null || isDynamicArrayElement === false) {
          const fragment = decodeWellFormedTuple(
            depth, data, paramIdx + 1,
            [...collectedParams, { offset: maybeOffset, length: null }],
            Math.min(endOfStaticCalldata, maybeOffset),
            expectedLength, isDynamicArrayElement
          );
          if (testParams(fragment)) return fragment;
        }
      }

      // Assume static bytes32 (only if not constrained to dynamic)
      if (isDynamicArrayElement !== null) return null;

      const fragment = decodeWellFormedTuple(
        depth, data, paramIdx + 1,
        [...collectedParams, PType.from('bytes32')],
        endOfStaticCalldata, expectedLength, isDynamicArrayElement
      );
      if (testParams(fragment)) return fragment;

      return null;
    }

    // Resolve dynamic variables
    if (expectedLength !== null && collectedParams.length !== expectedLength) return null;

    const maybeResolveDynamicParam = (idx) => {
      const param = collectedParams[idx];
      if (PType.isParamType(param)) return param;

      const nextDynamic = collectedParams.find((v, i) => i > idx && !PType.isParamType(v));
      const isTrailing = nextDynamic === undefined;
      const maybeDynLen = param.length;

      const dynStart = param.offset + (maybeDynLen !== null ? 32 : 0);
      const dynEnd = isTrailing ? data.length : nextDynamic.offset;
      const dynData = data.slice(dynStart, dynEnd);

      if (maybeDynLen === null) {
        // No length → must be tuple or static array
        const params = decodeWellFormedTuple(depth + 1, dynData, 0, [], dynData.length, null, null);
        if (!params) return undefined;
        return PType.from('(' + gFormatParams(params) + ')');
      }

      if (maybeDynLen === 0) {
        return PType.from('()[]'); // sentinel: empty string/bytes/array
      }

      if (
        maybeDynLen === dynData.length ||
        (dynData.length % 32 === 0 &&
          dynData.length - maybeDynLen < 32 &&
          dynData.slice(maybeDynLen).filter(v => v !== 0).length === 0)
      ) {
        return PType.from('bytes'); // bytestring
      }

      // Ambiguous – try all interpretations and pick shortest valid
      const allResults = [];

      // 1) Dynamic array with length prefix (e.g. string[])
      const r1 = decodeWellFormedTuple(depth + 1, dynData, 0, [], dynData.length, maybeDynLen, true);
      if (r1) allResults.push(r1);

      // 2) Dynamic array without length prefix (e.g. (uint256,string)[])
      const r2 = decodeWellFormedTuple(depth + 1, dynData, 0, [], dynData.length, maybeDynLen, false);
      if (r2) allResults.push(r2);

      // 3) Static array of fixed-size elements
      {
        const numWords = dynData.length / 32;
        const wordsPerElem = Math.floor(numWords / maybeDynLen);
        const staticParsed = [];
        let ok = true;
        for (let ei = 0; ei < maybeDynLen && ok; ei++) {
          const chunk = dynData.slice(ei * wordsPerElem * 32, (ei + 1) * wordsPerElem * 32);
          const params = decodeWellFormedTuple(depth + 1, chunk, 0, [], chunk.length, null, null);
          if (!params || params.length === 0) { ok = false; break; }
          staticParsed.push(params.length > 1 ? PType.from('(' + gFormatParams(params) + ')') : params[0]);
        }
        if (ok && staticParsed.length > 0) allResults.push(staticParsed);
      }

      const validResults = allResults
        .map(r => gGenerateConsistentResult(r))
        .filter(v => v !== null && v.format() !== '()[]')
        .sort((a, b) => a.format().length - b.format().length);

      if (validResults.length === 0) return undefined;
      return PType.from(validResults[0].format() + '[]');
    };

    const finalParams = [];
    for (let i = 0; i < collectedParams.length; i++) {
      const decoded = maybeResolveDynamicParam(i);
      if (!decoded) return null;
      finalParams.push(decoded);
    }

    return testParams(finalParams) ? finalParams : null;
  }

  // Merge types to find greatest common denominator
  function gMergeTypes(types) {
    if (types.length === 0) return PType.from('()');
    if (types.length === 1) return types[0];
    const bases = new Set(types.map(v => v.baseType));
    if (bases.size === 1) {
      const base = bases.values().next().value;
      if (base === 'tuple') {
        const compArrays = types.map(v => v.components);
        if (new Set(compArrays.map(c => c.length)).size !== 1) return PType.from('()');
        const merged = [];
        for (let i = 0; i < compArrays[0].length; i++) {
          merged.push(gMergeTypes(compArrays.map(c => c[i])));
        }
        return PType.from('(' + gFormatParams(merged) + ')');
      }
      if (base === 'array') {
        return PType.from(gMergeTypes(types.map(v => v.arrayChildren)).format() + '[]');
      }
    }
    const typeSet = new Set(types.map(v => v.type));
    if (typeSet.size === 1) return types[0];
    if (typeSet.has('bytes')) return PType.from('bytes');
    if (typeSet.has('uint256')) return PType.from('uint256');
    return PType.from('bytes32');
  }

  // Infer concrete types from basic guessed types + decoded values
  function gInferTypes(params, vals) {
    return params.map((param, idx) => {
      const val = vals[idx];
      if (param.isTuple()) {
        return PType.from('(' + gFormatParams(gInferTypes(param.components, val)) + ')');
      }
      if (param.isArray()) {
        const childTypes = Array(Array.isArray(val) ? val.length : 0).fill(param.arrayChildren);
        return PType.from(gMergeTypes(gInferTypes(childTypes, Array.isArray(val) ? val : [])).format() + '[]');
      }
      if (param.type === 'bytes32') {
        const raw = typeof val === 'string' ? gDecodeHex(val) : new Uint8Array(32);
        const lead = gCountLeadingZeros(raw);
        const trail = gCountTrailingZeros(raw);
        if (lead >= 12 && lead <= 17) return PType.from('address');
        if (lead > 16) return PType.from('uint256');
        if (trail > 0) return PType.from('bytes' + (32 - trail));
        return PType.from('bytes32');
      }
      if (param.type === 'bytes') {
        if (typeof val === 'string' && val.startsWith('0x') && val.length > 2) {
          try {
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(gDecodeHex(val));
            if (decoded.length > 0) return PType.from('string');
          } catch {}
        }
        return PType.from('bytes');
      }
      return param;
    });
  }

  // Entry point: guess ABI structure from param data (no selector)
  function guessAbiEncodedData(hexData) {
    const data = gDecodeHex(hexData);
    if (data.length === 0 || data.length % 32 !== 0) return null;

    const params = decodeWellFormedTuple(0, data, 0, [], data.length, null, null);
    if (!params) return null;

    try {
      const vals = gDecodeValues(params, data);
      return gInferTypes(params, vals);
    } catch {
      return params; // return un-inferred if decode fails
    }
  }

  function tryGuessABIStructure(paramData) {
    const hex = paramData.startsWith('0x') ? paramData.slice(2) : paramData;
    if (hex.length < 64 || hex.length % 64 !== 0) return null;

    const guessedTypes = guessAbiEncodedData(hex);
    if (!guessedTypes || guessedTypes.length === 0) return null;

    const types = guessedTypes.map(t => t.format());

    // Re-decode using existing ABI-guided decoders for proper value extraction
    const params = [];
    let offset = 0;
    for (let i = 0; i < types.length; i++) {
      try {
        const res = decodeParam(paramData, offset, types[i]);
        params.push({ name: `param${i}`, type: types[i], value: res.value });
        offset += res.len;
      } catch {
        return null;
      }
    }

    return { types, params };
  }

  // Adapter: ERC4337 packed handleOps (selector 0x765e827f)
  registerDecodeAdapter({
    id: 'erc4337_handleops_packed_v07',
    match: ({ selector }) => selector === '0x765e827f',
    decode: ({ calldata, selector }) => {
      const signature = KNOWN_SELECTORS[selector];
      const types = parseSignatureTypes(signature);
      const paramNames = ['ops', 'beneficiary'];
      const params = [];
      const paramData = slice(calldata, 4);
      const dataLen = (paramData.length - 2) / 2;

      let offset = 0;
      for (let i = 0; i < types.length && offset < dataLen; i++) {
        const res = decodeParam(paramData, offset, types[i]);
        params.push({ name: paramNames[i] || `param${i}`, type: types[i], value: res.value });
        offset += res.len;
      }

      return {
        selector,
        signature,
        funcName: 'handleOps',
        params
      };
    }
  });

  // Adapter: ERC7579/AA execute(bytes32,bytes) where arg1 is packed:
  // target(20) + value(32) + calldata(bytes)
  registerDecodeAdapter({
    id: 'execute_bytes32_bytes_packed_single_call',
    match: ({ selector }) => selector === '0xe9ae5c53',
    decode: ({ calldata, selector }) => {
      const signature = KNOWN_SELECTORS[selector] || 'execute(bytes32,bytes)';
      const clean = (calldata || '').replace(/^0x/, '');

      // Always keep this selector on adapter path (do not fall back to generic),
      // because generic ABI recursion misreads packed executionData as calldata.
      const fallbackResult = {
        selector,
        signature,
        funcName: 'execute',
        params: [
          { name: 'mode', type: 'bytes32', value: 'invalid' },
          { name: 'executionData', type: 'bytes', value: 'invalid packed execute payload' }
        ]
      };

      // selector(4) + mode(32) + offset(32)
      if (clean.length < 8 + 64 + 64) {
        return fallbackResult;
      }

      const mode = '0x' + clean.slice(8, 72);
      const offsetBig = safeBigInt('0x' + clean.slice(72, 136));
      if (offsetBig === null) {
        return fallbackResult;
      }
      const offset = Number(offsetBig);

      const tailStart = 8 + offset * 2;
      if (tailStart + 64 > clean.length) {
        return {
          selector,
          signature,
          funcName: 'execute',
          params: [
            { name: 'mode', type: 'bytes32', value: mode },
            { name: 'executionData', type: 'bytes', value: 'invalid bytes offset' }
          ]
        };
      }

      const bytesLenBig = safeBigInt('0x' + clean.slice(tailStart, tailStart + 64));
      if (bytesLenBig === null) {
        return {
          selector,
          signature,
          funcName: 'execute',
          params: [
            { name: 'mode', type: 'bytes32', value: mode },
            { name: 'executionData', type: 'bytes', value: 'invalid bytes length' }
          ]
        };
      }
      const bytesLen = Number(bytesLenBig);
      const bytesStart = tailStart + 64;
      const bytesEnd = bytesStart + bytesLen * 2;
      if (bytesEnd > clean.length || bytesLen <= 0) {
        return {
          selector,
          signature,
          funcName: 'execute',
          params: [
            { name: 'mode', type: 'bytes32', value: mode },
            { name: 'executionData', type: 'bytes', value: 'invalid bytes payload' }
          ]
        };
      }

      const executionData = '0x' + clean.slice(bytesStart, bytesEnd);
      const packed = tryParsePackedExecutionData(executionData);
      if (!packed) {
        return {
          selector,
          signature,
          funcName: 'execute',
          params: [
            { name: 'mode', type: 'bytes32', value: mode },
            { name: 'executionData', type: 'bytes', value: executionData }
          ]
        };
      }

      return {
        selector,
        signature,
        funcName: 'execute',
        params: [
          { name: 'mode', type: 'bytes32', value: mode },
          { name: 'executionData', type: '(address,uint256,bytes)', value: [packed.target, packed.value, packed.data] }
        ]
      };
    }
  });

  // Main decode function
  async function decodeCalldata(calldata) {
    if (!calldata || calldata.length < 10) {
      return { error: 'Invalid calldata' };
    }

    const selector = slice(calldata, 0, 4);

    // Protocol adapters get first pass.
    const adapterResult = await tryDecodeWithAdapters(calldata, selector);
    if (adapterResult) {
      return adapterResult;
    }

    const sig = await fetchSignature(selector);
    const funcName = sig ? sig.split('(')[0] : null;

    if (calldata.length === 10) {
      return { selector, signature: sig, funcName, params: [] };
    }

    const paramData = slice(calldata, 4);
    const dataLen = (paramData.length - 2) / 2;
    const wordCount = Math.floor(dataLen / 32);

    // If we have signature, decode with types
    if (sig) {
      const types = parseSignatureTypes(sig);
      const params = [];
      let offset = 0;

      for (let i = 0; i < types.length && offset < dataLen; i++) {
        const res = decodeParam(paramData, offset, types[i]);
        params.push({ name: `param${i}`, type: types[i], value: res.value });
        offset += res.len;
      }
      return { selector, signature: sig, funcName, params };
    }

    // Try ABI structure guessing before heuristic fallback
    const guessed = tryGuessABIStructure(paramData);
    if (guessed && guessed.params.length > 0) {
      const guessedSig = `guessed_${selector.slice(2)}(${guessed.types.join(',')})`;
      return {
        selector,
        signature: guessedSig,
        funcName: `unknown_${selector.slice(2)}`,
        params: guessed.params
      };
    }

    // Heuristic decode
    const params = [];
    const decodedRanges = []; // [{start, end}] ranges to skip

    for (let i = 0; i < wordCount; i++) {
      const wordOffset = i * 32;

      // Skip if this offset falls within a decoded range
      const inDecodedRange = decodedRanges.some(r => wordOffset >= r.start && wordOffset < r.end);
      if (inDecodedRange) continue;

      const word = slice(paramData, wordOffset, wordOffset + 32);
      const analysis = analyzeWord(word, wordOffset, paramData);

      // Track decoded dynamic data ranges
      if (analysis.ptr !== undefined) {
        const start = analysis.ptr;
        const end = analysis.endOffset || (analysis.ptr + 64); // Default: at least ptr + length word
        decodedRanges.push({ start, end });
      }

      params.push({ name: `param${params.length}`, ...analysis });
    }

    return { selector, signature: sig, funcName, params };
  }

  // Decode raw ABI data (no selector) - for bytes that aren't calldata
  function decodeRawABI(hex) {
    if (!hex || hex.length < 4) {
      return { error: 'Invalid data', params: [] };
    }

    const data = hex.startsWith('0x') ? hex : '0x' + hex;
    const dataLen = (data.length - 2) / 2;
    const wordCount = Math.floor(dataLen / 32);

    if (wordCount === 0) {
      return { params: [{ name: 'data', type: 'bytes', value: data }] };
    }

    // Try structure guessing first
    const guessed = tryGuessABIStructure(data);
    if (guessed && guessed.params.length > 0) {
      return { params: guessed.params.map((p, i) => ({ ...p, name: `[${i}]` })) };
    }

    const params = [];
    const decodedRanges = [];

    for (let i = 0; i < wordCount; i++) {
      const wordOffset = i * 32;

      // Skip if within decoded range
      const inDecodedRange = decodedRanges.some(r => wordOffset >= r.start && wordOffset < r.end);
      if (inDecodedRange) continue;

      const word = slice(data, wordOffset, wordOffset + 32);
      const analysis = analyzeWord(word, wordOffset, data);

      if (analysis.ptr !== undefined) {
        const start = analysis.ptr;
        const end = analysis.endOffset || (analysis.ptr + 64);
        decodedRanges.push({ start, end });
      }

      params.push({ name: `[${params.length}]`, ...analysis });
    }

    return { params };
  }

  // Format value for display - returns object with html and metadata
  function formatValue(value, type, paramId) {
    if (Array.isArray(value)) {
      // Check if this is an array of tuples (type ends with [])
      if (type.endsWith('[]')) {
        const elemType = type.slice(0, -2);
        const items = value.map((v, i) => {
          const formatted = formatValue(v, elemType, `${paramId}_${i}`);
          return `<div class="ms-2 mb-2 border-start border-2 ps-2" style="max-width:100%;overflow-x:auto;">[${i}] ${formatted.html}</div>`;
        }).join('');
        return { html: `<div class="array-items" style="max-width:100%;">${items}</div>`, isBytes: false };
      }
      // Tuple value (array of mixed types)
      if (type === 'tuple' || type.startsWith('(')) {
        const tupleTypes = type.startsWith('(') ? parseSignatureTypes(type) : [];
        const items = value.map((v, i) => {
          let inferredType = tupleTypes[i] || inferType(v);
          const formatted = formatValue(v, inferredType, `${paramId}_${i}`);
          const tLabel = tupleTypes[i] || '';
          const truncatedLabel = tLabel.length > 15 ? tLabel.slice(0,15)+'...' : tLabel;
          const typeLabel = tLabel ? `<span class="badge bg-secondary bg-opacity-10 text-dark me-1" style="font-size:10px;" title="${tLabel}">${truncatedLabel}</span>` : '';
          return `<div class="ms-2 mb-1" style="max-width:100%;overflow-x:auto;">[${i}] ${typeLabel}${formatted.html}</div>`;
        }).join('');
        return { html: `<div class="tuple-items" style="max-width:100%;">${items}</div>`, isBytes: false };
      }
      // Simple array
      const items = value.map((v, i) => {
        const formatted = formatValue(v, inferType(v), `${paramId}_${i}`);
        return `<div class="ms-2 mb-1" style="max-width:100%;overflow-x:auto;">[${i}] ${formatted.html}</div>`;
      }).join('');
      return { html: `<div class="array-items" style="max-width:100%;">${items}</div>`, isBytes: false };
    }
    if (type === 'address') {
      return {
        html: `<a href="/address/${value}" class="hash-tag text-nowrap" target="_blank">${value}</a>`,
        isBytes: false
      };
    }
    if (type === 'bool') {
      return { html: value ? 'true' : 'false', isBytes: false };
    }
    if (type === 'timestamp') {
      const date = new Date(Number(value) * 1000);
      return { html: `${value} (${date.toISOString()})`, isBytes: false };
    }
    // uint256 with unit conversion dropdown
    if (type && (type.startsWith('uint') || type.startsWith('int'))) {
      const id = `unit-${paramId}`;
      const displayVal = formatWithCommas(value);
      const optionsHtml = UNIT_OPTIONS.map((opt, i) =>
        `<option value="${opt.decimals}" ${i === 0 ? 'selected' : ''}>${opt.label}</option>`
      ).join('');
      return {
        html: `<span class="d-inline-flex align-items-center gap-2" style="flex-wrap:wrap;">
          <span class="font-monospace unit-value" data-wei="${value}" id="${id}-val">${displayVal}</span>
          <select class="form-select form-select-sm unit-select" style="width:auto;padding:2px 24px 2px 8px;font-size:12px;" data-target="${id}-val">
            ${optionsHtml}
          </select>
        </span>`,
        isBytes: false
      };
    }
    // Bytes - check if could be nested calldata or raw ABI
    if (type === 'bytes' || type === 'bytes32') {
      const strVal = String(value);
      const canDecodeCalldata = couldBeCalldata(strVal);
      // Can decode as raw ABI if at least 64 chars (32 bytes = 1 word)
      const canDecodeABI = !canDecodeCalldata && strVal.length >= 66 && /^0x[0-9a-fA-F]+$/.test(strVal);
      const displayVal = strVal.length > 25 ? strVal.slice(0, 25) + '...' : strVal;
      const copyId = `copy-${paramId}`;

      if (canDecodeCalldata) {
        const id = `nested-${paramId}`;
        pendingAutoExpand[`data-${id}`] = strVal;
        return {
          html: `<div class="nested-bytes" id="${id}" data-calldata-id="data-${id}" style="max-width:100%;">
            <div class="d-flex align-items-center gap-2" style="flex-wrap:wrap;">
              <button class="btn btn-sm btn-outline-secondary decode-nested-btn flex-shrink-0" style="font-size:11px;padding:2px 8px;">
                <i class="fas fa-chevron-down me-1 toggle-icon"></i>Decode
              </button>
              <code style="font-size:12px;" title="${strVal}">${displayVal}</code>
              <button class="btn btn-sm btn-outline-secondary copy-btn flex-shrink-0" data-copy="${copyId}" style="font-size:11px;padding:2px 6px;" title="Copy">
                <i class="far fa-copy"></i>
              </button>
              <input type="hidden" id="${copyId}" value="${strVal}">
            </div>
            <div class="nested-decoded mt-2"></div>
          </div>`,
          isBytes: true,
          bytesValue: strVal
        };
      }
      if (canDecodeABI) {
        const id = `abi-${paramId}`;
        pendingAutoExpand[`data-${id}`] = strVal;
        return {
          html: `<div class="nested-abi" id="${id}" data-abi-id="data-${id}" style="max-width:100%;">
            <div class="d-flex align-items-center gap-2" style="flex-wrap:wrap;">
              <button class="btn btn-sm btn-outline-info decode-abi-btn flex-shrink-0" style="font-size:11px;padding:2px 8px;">
                <i class="fas fa-chevron-down me-1 toggle-icon"></i>Decode ABI
              </button>
              <code style="font-size:12px;" title="${strVal}">${displayVal}</code>
              <button class="btn btn-sm btn-outline-secondary copy-btn flex-shrink-0" data-copy="${copyId}" style="font-size:11px;padding:2px 6px;" title="Copy">
                <i class="far fa-copy"></i>
              </button>
              <input type="hidden" id="${copyId}" value="${strVal}">
            </div>
            <div class="abi-decoded mt-2"></div>
          </div>`,
          isBytes: true,
          bytesValue: strVal
        };
      }
      return {
        html: `<span class="d-inline-flex align-items-center gap-2" style="flex-wrap:wrap;max-width:100%;">
          <code style="font-size:12px;" title="${strVal}">${displayVal}</code>
          <button class="btn btn-sm btn-outline-secondary copy-btn flex-shrink-0" data-copy="${copyId}" style="font-size:11px;padding:2px 6px;" title="Copy">
            <i class="far fa-copy"></i>
          </button>
          <input type="hidden" id="${copyId}" value="${strVal}">
        </span>`,
        isBytes: false
      };
    }
    return { html: `<span style="word-break:break-word;">${String(value)}</span>`, isBytes: false };
  }

  // Create decoded UI matching Etherscan's row style
  function createDecodedUI(result, isNested = false) {
    const container = document.createElement('div');
    if (!isNested) {
      container.id = 'calldata-decoded';
      container.className = 'row mb-4';
    } else {
      container.className = 'nested-result border-start border-2 ps-3 mt-2';
      container.style.cssText = 'max-width:100%;overflow-x:auto;';
    }

    const funcDisplay = result.signature || result.funcName || result.selector;
    let firstBytesAutoExpanded = false;

    let paramsHtml = '';
    if (result.params && result.params.length > 0) {
      const bgClass = isNested ? 'bg-light bg-opacity-50' : 'bg-light';
      paramsHtml = `<div class="border rounded mt-2" style="max-width:100%;overflow-x:auto;"><div class="${bgClass} p-3" style="max-width:100%;">`;
      result.params.forEach((p, i) => {
        const typeLabel = p.type || 'unknown';
        const paramId = `p${Date.now()}_${i}`;
        const formatted = formatValue(p.value, p.type, paramId);

        // Auto-expand first nested bytes if not already done
        let autoExpandId = null;
        if (formatted.isBytes && !firstBytesAutoExpanded && nestedDecodeCount === 0) {
          firstBytesAutoExpanded = true;
          autoExpandId = `nested-${paramId}`;
          pendingAutoExpand[autoExpandId] = formatted.bytesValue;
          nestedDecodeCount++;
        }

        const truncatedType = typeLabel.length > 25 ? typeLabel.slice(0, 25) + '...' : typeLabel;
        paramsHtml += `<div class="mb-2" style="font-size:12px;max-width:100%;" ${autoExpandId ? `data-auto-expand="${autoExpandId}"` : ''}>
          <div class="d-flex align-items-center gap-1 mb-1">
            <span class="text-muted">[${i}]</span>
            <span class="badge bg-secondary bg-opacity-10 border border-secondary border-opacity-25 text-dark fw-medium py-1 px-2" title="${typeLabel}">${truncatedType}</span>
          </div>
          <div class="font-monospace ps-3" style="max-width:100%;overflow-x:auto;">${formatted.html}</div>
        </div>`;
      });
      paramsHtml += '</div></div>';
    }

    if (isNested) {
      const truncatedFunc = funcDisplay && funcDisplay.length > 50 ? funcDisplay.slice(0, 50) + '...' : funcDisplay;
      container.innerHTML = `
        <div class="d-flex flex-wrap gap-1 align-items-center mb-2" style="font-size:11px;">
          <span class="badge bg-info bg-opacity-10 border border-info border-opacity-25 text-dark fw-medium py-1 px-2" title="${funcDisplay}">
            <span class="text-muted">Fn:</span> <span class="font-monospace">${truncatedFunc}</span>
          </span>
          <span class="badge bg-info bg-opacity-10 border border-info border-opacity-25 text-dark fw-medium py-1 px-2">
            <code>${result.selector}</code>
          </span>
        </div>
        ${paramsHtml}
      `;
    } else {
      container.innerHTML = `
        <div class="col-md-3 text-dt mb-2 mb-md-0">
          <i class="far fa-question-circle me-1" data-bs-toggle="tooltip" title="Decoded calldata showing function signature and parameters"></i>Decoded Input:
        </div>
        <div class="col-md-9">
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <span class="badge bg-secondary bg-opacity-10 border border-secondary border-opacity-25 text-dark fw-medium py-1.5 px-2">
              <span class="text-muted">Function:</span> <span class="font-monospace">${funcDisplay}</span>
            </span>
            <span class="badge bg-secondary bg-opacity-10 border border-secondary border-opacity-25 text-dark fw-medium py-1.5 px-2">
              <span class="text-muted">Selector:</span> <code>${result.selector}</code>
            </span>
          </div>
          ${paramsHtml}
        </div>
      `;
    }

    return container;
  }

  // Handle unit conversion
  function handleUnitConvert(selectEl) {
    const decimals = parseInt(selectEl.value, 10);
    const targetId = selectEl.getAttribute('data-target');
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;
    const wei = targetEl.getAttribute('data-wei');
    const converted = convertWeiToUnit(wei, decimals);
    targetEl.textContent = formatWithCommas(converted);
  }

  // Handle nested decode
  async function handleNestedDecode(container) {
    if (!container) return;

    const calldataId = container.getAttribute('data-calldata-id');
    const calldata = pendingAutoExpand[calldataId];
    if (!calldata) return;

    const btn = container.querySelector('.decode-nested-btn');
    const icon = btn?.querySelector('.toggle-icon');
    const decodedDiv = container.querySelector('.nested-decoded');

    // Toggle if already decoded
    if (decodedDiv.children.length > 0) {
      const isHidden = decodedDiv.style.display === 'none';
      decodedDiv.style.display = isHidden ? 'block' : 'none';
      if (icon) {
        icon.classList.toggle('fa-chevron-right', !isHidden);
        icon.classList.toggle('fa-chevron-down', isHidden);
      }
      return;
    }

    // Show loading
    if (btn) btn.disabled = true;
    decodedDiv.innerHTML = '<span class="text-muted">Decoding...</span>';

    try {
      const result = await decodeCalldata(calldata);
      if (result.error) {
        decodedDiv.innerHTML = `<span class="text-danger">Failed to decode</span>`;
      } else {
        const nestedUI = createDecodedUI(result, true);
        decodedDiv.innerHTML = '';
        decodedDiv.appendChild(nestedUI);
        attachEventListeners(decodedDiv);
        // Process auto-expand for nested
        processAutoExpand(decodedDiv);
      }
      if (icon) {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-down');
      }
    } catch (e) {
      console.error('Nested decode error:', e);
      decodedDiv.innerHTML = `<span class="text-danger">Decode error</span>`;
    }
    if (btn) btn.disabled = false;
  }

  // Handle raw ABI decode (no selector)
  async function handleABIDecode(container) {
    if (!container) return;

    const abiId = container.getAttribute('data-abi-id');
    const data = pendingAutoExpand[abiId];
    if (!data) return;

    const btn = container.querySelector('.decode-abi-btn');
    const icon = btn?.querySelector('.toggle-icon');
    const decodedDiv = container.querySelector('.abi-decoded');

    // Toggle if already decoded
    if (decodedDiv.children.length > 0) {
      const isHidden = decodedDiv.style.display === 'none';
      decodedDiv.style.display = isHidden ? 'block' : 'none';
      if (icon) {
        icon.classList.toggle('fa-chevron-right', !isHidden);
        icon.classList.toggle('fa-chevron-down', isHidden);
      }
      return;
    }

    // Show loading
    if (btn) btn.disabled = true;
    decodedDiv.innerHTML = '<span class="text-muted">Decoding...</span>';

    try {
      const result = decodeRawABI(data);
      if (result.error || !result.params.length) {
        decodedDiv.innerHTML = `<span class="text-danger">Failed to decode</span>`;
      } else {
        // Create simple param display
        const paramsHtml = result.params.map((p, i) => {
          const paramId = `abi_${Date.now()}_${i}`;
          const formatted = formatValue(p.value, p.type, paramId);
          const typeLabel = p.type || 'unknown';
          return `<div class="mb-2" style="font-size:12px;">
            <div class="d-flex align-items-center gap-1 mb-1">
              <span class="text-muted">${p.name}</span>
              <span class="badge bg-secondary bg-opacity-10 border text-dark py-1 px-2">${typeLabel}</span>
            </div>
            <div class="font-monospace ps-3">${formatted.html}</div>
          </div>`;
        }).join('');
        decodedDiv.innerHTML = `<div class="border-start border-2 ps-3 mt-2 bg-light bg-opacity-50 p-2 rounded">${paramsHtml}</div>`;
        attachEventListeners(decodedDiv);
      }
      if (icon) {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-down');
      }
    } catch (e) {
      console.error('ABI decode error:', e);
      decodedDiv.innerHTML = `<span class="text-danger">Decode error</span>`;
    }
    if (btn) btn.disabled = false;
  }

  // Attach event listeners to UI elements
  function attachEventListeners(container) {
    // Unit conversion dropdowns
    container.querySelectorAll('.unit-select').forEach(select => {
      select.addEventListener('change', () => handleUnitConvert(select));
    });

    // Decode calldata buttons
    container.querySelectorAll('.decode-nested-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nestedContainer = btn.closest('.nested-bytes');
        handleNestedDecode(nestedContainer);
      });
    });

    // Decode ABI buttons
    container.querySelectorAll('.decode-abi-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const abiContainer = btn.closest('.nested-abi');
        handleABIDecode(abiContainer);
      });
    });

    // Copy buttons
    container.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const copyId = btn.getAttribute('data-copy');
        const input = document.getElementById(copyId);
        if (input) {
          try {
            await navigator.clipboard.writeText(input.value);
            const icon = btn.querySelector('i');
            if (icon) {
              icon.classList.remove('fa-copy');
              icon.classList.add('fa-check');
              setTimeout(() => {
                icon.classList.remove('fa-check');
                icon.classList.add('fa-copy');
              }, 1500);
            }
          } catch (e) {
            console.error('Copy failed:', e);
          }
        }
      });
    });
  }

  // Auto-expand first nested bytes
  function processAutoExpand(container) {
    const autoExpand = container.querySelector('[data-auto-expand]');
    if (autoExpand) {
      const id = autoExpand.getAttribute('data-auto-expand');
      const nestedContainer = document.getElementById(id);
      if (nestedContainer) {
        setTimeout(() => handleNestedDecode(nestedContainer), 100);
      }
    }
  }

  // Main function
  async function injectDecoder() {
    // Prevent concurrent calls
    if (isDecoding || document.getElementById('calldata-decoded')) return;

    const inputEl = document.getElementById('inputdata');
    if (!inputEl) return;

    const calldata = inputEl.value || inputEl.textContent;
    if (!calldata || !calldata.startsWith('0x') || calldata.length < 10) return;

    isDecoding = true;
    nestedDecodeCount = 0; // Reset for each new decode

    try {
      const result = await decodeCalldata(calldata.trim());
      if (result.error) return;

      // Double-check after async call
      if (document.getElementById('calldata-decoded')) return;

      const ui = createDecodedUI(result);

      const inputRow = inputEl.closest('.row.mb-4');
      if (inputRow && inputRow.parentNode) {
        inputRow.parentNode.insertBefore(ui, inputRow.nextSibling);
        // Attach event listeners
        attachEventListeners(ui);
        // Auto-expand first nested bytes
        processAutoExpand(ui);
      }
    } catch (e) {
      console.error('Calldata decode error:', e);
    } finally {
      isDecoding = false;
    }
  }

  // Run decoder
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(injectDecoder, 500));
  } else {
    setTimeout(injectDecoder, 500);
  }

  // Watch for dynamic content updates
  const decoderObserver = new MutationObserver(() => {
    if (!document.getElementById('calldata-decoded') && document.getElementById('inputdata')) {
      setTimeout(injectDecoder, 200);
    }
  });
  decoderObserver.observe(document.body, { childList: true, subtree: true });
})();
