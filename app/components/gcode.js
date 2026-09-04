/**
 * G-code and bgcode metadata parser.
 *
 * This module reads metadata emitted by slicers; it does not interpret motion
 * commands or estimate print time from feed rates. Missing values remain null.
 *
 * parseGcodeMeta() is asynchronous because bgcode metadata blocks may use
 * browser-supported Deflate compression.
 */

const BGCODE_MAGIC = 0x45444347; // "GCDE" as a little-endian uint32
const BGCODE_HEADER_BYTES = 10;
const BGCODE_BLOCK_HEADER_BYTES = 8;
const BGCODE_COMPRESSED_HEADER_BYTES = 12;
const BGCODE_CRC32_BYTES = 4;
const MAX_TEXT_SAMPLE_BYTES = 256 * 1024;

const BLOCK_PARAMETER_BYTES = {
  0: 2, // File metadata
  1: 2, // G-code
  2: 2, // Slicer metadata
  3: 2, // Printer metadata
  4: 2, // Print metadata
  5: 6, // Thumbnail
};

const METADATA_BLOCK_TYPES = new Set([0, 2, 3, 4]);
const BLOCK_SECTION_NAMES = {
  0: "file",
  2: "slicer",
  3: "printer",
  4: "print",
};

/**
 * @param {string} key
 */
function normalizeKey(key) {
  return String(key)
    .trim()
    .toLowerCase()
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * @param {string} value
 */
function parseNumber(value) {
  const match = String(value).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {string} value
 */
function parseDurationSeconds(value) {
  const text = String(value).trim().toLowerCase();
  if (!text) return null;

  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) {
    const hours = Number(clock[1] ?? 0);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  let total = 0;
  let foundUnit = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g)) {
    foundUnit = true;
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith("h")) total += amount * 3600;
    else if (unit.startsWith("m")) total += amount * 60;
    else total += amount;
  }
  if (foundUnit) return Number.isFinite(total) ? total : null;

  const seconds = Number(text);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * @param {string} value
 */
function parseLengthMillimetres(value) {
  const match = String(value).trim().match(
    /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(mm|cm|m)?\b/i
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "m") return amount * 1000;
  if (unit === "cm") return amount * 10;
  return amount;
}

/**
 * @param {string} value
 * @param {string} unit
 */
function parseMass(value, unit) {
  const number = parseNumber(value);
  if (number === null) return null;
  if (unit === "kg") return number * 1000;
  return number;
}

/**
 * @param {string} value
 */
function parseBooleanValue(value) {
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

/**
 * @param {string} key
 * @param {string} value
 */
function parseProducedTimestamp(key, value) {
  const date = key.match(/^produced_on_(\d{4})_(\d{2})_(\d{2})_at_(\d{1,2})$/);
  if (!date) return null;
  const time = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(.*)$/);
  if (!time) return null;
  const [, year, month, day, hour] = date;
  const [, first, second, third, zone] = time;
  const minute = third ? second : first;
  const seconds = third ?? second;
  return `${year}-${month}-${day} ${hour.padStart(2, "0")}:${minute}:${seconds}${
    zone ? ` ${zone.trim()}` : ""
  }`;
}

/**
 * @param {"gcode" | "bgcode"} format
 */
function createResult(format) {
  return {
    format,
    timestamp: null,
    durationSec: null,
    filamentGrams: null,
    filamentMm: null,
    filamentM: null,
    filamentCm3: null,
    filamentType: null,
    nozzleMm: null,
    nozzleHighFlow: null,
    bedTemperatureC: null,
    fillDensityPercent: null,
    nozzleTemperatureC: null,
    layerHeightMm: null,
    perimeters: null,
    objectCount: null,
    objects: [],
    wipeTowerFilamentGrams: null,
    slicer: null,
    printerModel: null,
    raw: {},
    warnings: [],
  };
}

/**
 * @param {ReturnType<typeof createResult>} result
 * @param {string} field
 * @param {unknown} value
 * @param {number} priority
 * @param {Record<string, number>} priorities
 */
function setField(result, field, value, priority, priorities) {
  if (value === null || value === undefined || value === "") return;
  if ((priorities[field] ?? -1) > priority) return;
  result[field] = value;
  priorities[field] = priority;
}

/**
 * @param {ReturnType<typeof createResult>} result
 * @param {string} key
 * @param {string} value
 * @param {string} [section]
 * @param {Record<string, number>} priorities
 */
function applyMetadataValue(result, key, value, section, priorities) {
  const normalized = normalizeKey(key);
  const trimmedValue = String(value).trim();
  if (!normalized || !trimmedValue) return;

  const rawKey = section ? `${normalizeKey(section)}.${normalized}` : normalized;
  result.raw[rawKey] = trimmedValue;

  const lower = normalized;
  setField(
    result,
    "timestamp",
    parseProducedTimestamp(lower, trimmedValue) ??
      (["timestamp", "generated_on", "produced_on"].includes(lower) ? trimmedValue : null),
    1,
    priorities
  );

  if (
    lower === "time" ||
    lower === "print_time" ||
    lower === "estimated_time" ||
    lower === "total_estimated_time" ||
    (lower.startsWith("estimated_printing_time") && !lower.includes("silent"))
  ) {
    setField(result, "durationSec", parseDurationSeconds(trimmedValue), 1, priorities);
  }

  const isTotal = lower.includes("total");
  if (lower === "total_filament_used_for_wipe_tower_g") {
    setField(
      result,
      "wipeTowerFilamentGrams",
      parseMass(trimmedValue, "g"),
      1,
      priorities
    );
  }
  if (lower.includes("filament") || lower.includes("material")) {
    const isWipeTower = lower.includes("wipe_tower");
    if (isWipeTower) {
      // Wipe-tower material is not the requested model filament total.
    } else if (lower.endsWith("_g") || lower === "filament_weight") {
      setField(
        result,
        "filamentGrams",
        parseMass(trimmedValue, lower.includes("kg") ? "kg" : "g"),
        isTotal ? 2 : 1,
        priorities
      );
    } else if (lower.endsWith("_mm")) {
      setField(
        result,
        "filamentMm",
        parseLengthMillimetres(trimmedValue),
        isTotal ? 2 : 1,
        priorities
      );
    } else if (lower.endsWith("_cm3")) {
      setField(
        result,
        "filamentCm3",
        parseNumber(trimmedValue),
        isTotal ? 2 : 1,
        priorities
      );
    } else if (lower === "filament_used" || lower === "total_filament_used") {
      setField(
        result,
        "filamentMm",
        parseLengthMillimetres(trimmedValue),
        isTotal ? 2 : 1,
        priorities
      );
    }
  }

  if (lower.includes("filament_type") || lower === "material_type") {
    setField(result, "filamentType", trimmedValue, 1, priorities);
  }
  if (lower === "nozzle" || lower === "nozzle_diameter" || lower === "nozzle_diameter_mm") {
    setField(result, "nozzleMm", parseNumber(trimmedValue), 1, priorities);
  }
  if (lower === "nozzle_high_flow") {
    setField(result, "nozzleHighFlow", parseBooleanValue(trimmedValue), 1, priorities);
  }
  if (lower === "bed_temperature" || lower === "bed_temperature_c") {
    setField(result, "bedTemperatureC", parseNumber(trimmedValue), 1, priorities);
  }
  if (lower === "fill_density" || lower === "fill_density_percent") {
    setField(result, "fillDensityPercent", parseNumber(trimmedValue), 1, priorities);
  }
  if (lower === "temperature" || lower === "nozzle_temperature") {
    setField(result, "nozzleTemperatureC", parseNumber(trimmedValue), 1, priorities);
  }
  if (lower === "layer_height" || lower === "layer_height_mm") {
    setField(result, "layerHeightMm", parseNumber(trimmedValue), 1, priorities);
  }
  if (lower === "perimeters" || lower === "wall_line_count") {
    setField(result, "perimeters", parseNumber(trimmedValue), 1, priorities);
  }
  if (lower === "objects_info" || lower === "objects_info_objects") {
    try {
      const parsed = JSON.parse(trimmedValue);
      const objects = Array.isArray(parsed) ? parsed : parsed?.objects;
      if (Array.isArray(objects)) {
        setField(result, "objects", objects, 1, priorities);
        setField(result, "objectCount", objects.length, 1, priorities);
      }
    } catch {
      // Keep the raw value when a slicer emits a non-JSON object description.
    }
  }
  if (
    lower === "slicer" ||
    lower === "generated_by" ||
    lower === "generator" ||
    lower === "producer"
  ) {
    setField(result, "slicer", trimmedValue, 1, priorities);
  }
  if (lower === "printer_model" || lower === "printer") {
    setField(result, "printerModel", trimmedValue, 1, priorities);
  }
}

/**
 * @param {string} text
 * @param {ReturnType<typeof createResult>} result
 * @param {{ commentsOnly?: boolean, priorities?: Record<string, number>, section?: string }} [options]
 */
function parseTextMetadata(
  text,
  result,
  { commentsOnly = false, priorities = {}, section: initialSection = "" } = {}
) {
  let section = initialSection;

  for (const line of String(text).split(/\r?\n/)) {
    let entry = line.trim();
    const isComment = entry.startsWith(";");
    if (isComment) entry = entry.slice(1).trim();
    if (commentsOnly && !isComment) continue;
    if (!entry) continue;

    const sectionMatch = entry.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const generatedBy = entry.match(/^generated\s+by\s*:?\s*(.+)$/i);
    if (generatedBy) {
      applyMetadataValue(result, "generated_by", generatedBy[1], section, priorities);
      continue;
    }

    const equals = entry.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (equals) {
      applyMetadataValue(result, equals[1], equals[2], section, priorities);
      continue;
    }

    const colon = entry.match(/^([^:]+):\s*(.+)$/);
    if (colon) {
      applyMetadataValue(result, colon[1], colon[2], section, priorities);
    }
  }
}

/**
 * @param {ReturnType<typeof createResult>} result
 */
function finalizeResult(result) {
  if (Number.isFinite(result.filamentMm)) {
    result.filamentM = result.filamentMm / 1000;
  }
  return result;
}

/**
 * @param {ArrayBuffer | Uint8Array} input
 */
function toBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Uint8Array) return input;
  throw new TypeError("G-code input must be a string, ArrayBuffer, or Uint8Array");
}

/**
 * Return whether a binary input has the bgcode magic number.
 *
 * @param {ArrayBuffer | Uint8Array} input
 */
export function isBgcode(input) {
  try {
    const bytes = toBytes(input);
    return (
      bytes.byteLength >= 4 &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) ===
        BGCODE_MAGIC
    );
  } catch {
    return false;
  }
}

/**
 * @param {Uint8Array} bytes
 */
function decodeTextSample(bytes) {
  if (bytes.byteLength <= MAX_TEXT_SAMPLE_BYTES * 2) {
    return new TextDecoder().decode(bytes);
  }
  const first = bytes.subarray(0, MAX_TEXT_SAMPLE_BYTES);
  const last = bytes.subarray(bytes.byteLength - MAX_TEXT_SAMPLE_BYTES);
  return `${new TextDecoder().decode(first)}\n${new TextDecoder().decode(last)}`;
}

/**
 * @param {Uint8Array} bytes
 */
async function decompressDeflate(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Deflate decompression is unavailable in this browser");
  }

  let lastError;
  for (const format of ["deflate", "deflate-raw"]) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Unable to decompress Deflate data");
}

/**
 * @param {Uint8Array} bytes
 * @param {number} windowBits
 * @param {number} lookaheadBits
 * @param {number} expectedSize
 */
function decompressHeatshrink(bytes, windowBits, lookaheadBits, expectedSize) {
  const output = new Uint8Array(expectedSize);
  const window = new Uint8Array(1 << windowBits);
  const mask = window.length - 1;
  let bitOffset = 0;
  let head = 0;
  let outputOffset = 0;

  function readBits(count) {
    if (bitOffset + count > bytes.length * 8) {
      throw new Error("Heatshrink payload ended before the expected output");
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[Math.floor(bitOffset / 8)];
      const bit = 7 - (bitOffset % 8);
      value = (value << 1) | ((byte >> bit) & 1);
      bitOffset += 1;
    }
    return value;
  }

  while (outputOffset < expectedSize) {
    const isLiteral = readBits(1) === 1;
    if (isLiteral) {
      const value = readBits(8);
      output[outputOffset] = value;
      window[head & mask] = value;
      head += 1;
      outputOffset += 1;
      continue;
    }

    const offset = readBits(windowBits) + 1;
    const count = readBits(lookaheadBits) + 1;
    for (let index = 0; index < count && outputOffset < expectedSize; index += 1) {
      const value = window[(head - offset) & mask];
      output[outputOffset] = value;
      window[head & mask] = value;
      head += 1;
      outputOffset += 1;
    }
  }

  return output;
}

const MEATPACK_LOOKUP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", " ", "\n", "G", "X"];
const MEATPACK_COMMANDS = {
  ENABLE_PACKING: 0xfb,
  DISABLE_PACKING: 0xfa,
  RESET: 0xf9,
  QUERY: 0xf8,
  ENABLE_NO_SPACES: 0xf7,
  DISABLE_NO_SPACES: 0xf6,
};

/**
 * @param {Uint8Array} bytes
 * @returns {{ bytes: Uint8Array, warnings: string[] }}
 */
function decodeMeatPack(bytes) {
  const output = [];
  const warnings = [];
  let packing = false;
  let noSpaces = false;

  const lookup = (value) => {
    if (value === 11 && noSpaces) return "E";
    return MEATPACK_LOOKUP[value];
  };

  const pushLiteral = (index) => {
    if (index >= bytes.length) {
      warnings.push("MeatPack literal is truncated");
      return false;
    }
    output.push(bytes[index]);
    return true;
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value === 0xff && bytes[index + 1] === 0xff) {
      const command = bytes[index + 2];
      if (command === undefined) {
        warnings.push("MeatPack command is truncated");
        break;
      }
      if (command === MEATPACK_COMMANDS.ENABLE_PACKING) packing = true;
      else if (command === MEATPACK_COMMANDS.DISABLE_PACKING) packing = false;
      else if (command === MEATPACK_COMMANDS.RESET) {
        packing = false;
        noSpaces = false;
      } else if (command === MEATPACK_COMMANDS.ENABLE_NO_SPACES) noSpaces = true;
      else if (command === MEATPACK_COMMANDS.DISABLE_NO_SPACES) noSpaces = false;
      else if (command !== MEATPACK_COMMANDS.QUERY) {
        warnings.push(`Unknown MeatPack command: 0x${command.toString(16)}`);
      }
      index += 2;
      continue;
    }

    if (!packing) {
      output.push(value);
      continue;
    }

    if (value === 0xff) {
      if (!pushLiteral(index + 1) || !pushLiteral(index + 2)) break;
      index += 2;
      continue;
    }

    const first = value & 0x0f;
    const second = (value >> 4) & 0x0f;
    if (first === 0x0f) {
      if (second === 0x0f) {
        if (!pushLiteral(index + 1) || !pushLiteral(index + 2)) break;
        index += 2;
      } else {
        if (!pushLiteral(index + 1)) break;
        output.push(lookup(second).charCodeAt(0));
        index += 1;
      }
    } else if (second === 0x0f) {
      output.push(lookup(first).charCodeAt(0));
      if (!pushLiteral(index + 1)) break;
      index += 1;
    } else {
      output.push(lookup(first).charCodeAt(0), lookup(second).charCodeAt(0));
    }
  }

  return { bytes: Uint8Array.from(output), warnings };
}

/**
 * @param {Uint8Array} bytes
 */
function readBgcodeBlocks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const warnings = [];
  const blocks = [];
  if (view.byteLength < BGCODE_HEADER_BYTES) {
    return { version: null, checksumType: null, blocks, warnings: ["bgcode header is truncated"] };
  }

  const version = view.getUint32(4, true);
  const checksumType = view.getUint16(8, true);
  if (version !== 1) warnings.push(`Unsupported bgcode version: ${version}`);
  if (checksumType !== 0 && checksumType !== 1) {
    warnings.push(`Unsupported bgcode checksum type: ${checksumType}`);
  }

  let offset = BGCODE_HEADER_BYTES;
  while (offset < view.byteLength) {
    if (offset + BGCODE_BLOCK_HEADER_BYTES > view.byteLength) {
      warnings.push("bgcode block header is truncated");
      break;
    }

    const type = view.getUint16(offset, true);
    const compression = view.getUint16(offset + 2, true);
    const uncompressedSize = view.getUint32(offset + 4, true);
    const headerBytes =
      compression === 0 ? BGCODE_BLOCK_HEADER_BYTES : BGCODE_COMPRESSED_HEADER_BYTES;
    if (offset + headerBytes > view.byteLength) {
      warnings.push("bgcode compressed block header is truncated");
      break;
    }

    const compressedSize =
      compression === 0 ? uncompressedSize : view.getUint32(offset + 8, true);
    const parameterBytes = BLOCK_PARAMETER_BYTES[type];
    if (parameterBytes === undefined) {
      warnings.push(`Unsupported bgcode block type: ${type}`);
      break;
    }

    const dataStart = offset + headerBytes + parameterBytes;
    const dataEnd = dataStart + compressedSize;
    const blockEnd = dataEnd + (checksumType === 1 ? BGCODE_CRC32_BYTES : 0);
    if (dataEnd > view.byteLength || blockEnd > view.byteLength) {
      warnings.push("bgcode block payload is truncated");
      break;
    }

    blocks.push({
      type,
      compression,
      uncompressedSize,
      encoding: parameterBytes >= 2 ? view.getUint16(offset + headerBytes, true) : null,
      payload: bytes.slice(dataStart, dataEnd),
    });
    offset = blockEnd;
  }

  return { version, checksumType, blocks, warnings };
}

/**
 * @param {{ compression: number, uncompressedSize: number, payload: Uint8Array }} block
 */
async function decodeBgcodeBlockPayload(block) {
  if (block.compression === 0) return block.payload;
  if (block.compression === 1) return decompressDeflate(block.payload);
  if (block.compression === 2) {
    return decompressHeatshrink(block.payload, 11, 4, block.uncompressedSize);
  }
  if (block.compression === 3) {
    return decompressHeatshrink(block.payload, 12, 4, block.uncompressedSize);
  }
  throw new Error(`Unsupported bgcode compression: ${block.compression}`);
}

/**
 * @param {Uint8Array} bytes
 * @param {ReturnType<typeof createResult>} result
 */
async function parseBgcode(bytes, result) {
  const parsed = readBgcodeBlocks(bytes);
  result.warnings.push(...parsed.warnings);
  const priorities = {};
  for (const block of parsed.blocks) {
    if (METADATA_BLOCK_TYPES.has(block.type)) {
      const encoding = block.encoding;
      if (encoding !== 0) {
        result.warnings.push(`Unsupported bgcode metadata encoding: ${encoding}`);
      } else {
        try {
          const decoded = await decodeBgcodeBlockPayload(block);
          parseTextMetadata(new TextDecoder().decode(decoded), result, {
            priorities,
            section: BLOCK_SECTION_NAMES[block.type],
          });
        } catch (error) {
          result.warnings.push(
            `Unable to decode bgcode metadata: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }

  return result;
}

/**
 * Decode all G-code blocks from ASCII G-code or binary bgcode.
 *
 * @param {string | ArrayBuffer | Uint8Array} input
 * @returns {Promise<{ text: string, warnings: string[] }>}
 */
export async function decodeBgcodeGcode(input) {
  if (typeof input === "string") return { text: input, warnings: [] };

  const bytes = toBytes(input);
  if (!isBgcode(bytes)) return { text: new TextDecoder().decode(bytes), warnings: [] };

  const parsed = readBgcodeBlocks(bytes);
  const warnings = [...parsed.warnings];
  const chunks = [];
  for (const block of parsed.blocks) {
    if (block.type !== 1) continue;
    if (block.encoding !== 0 && block.encoding !== 1 && block.encoding !== 2) {
      warnings.push(`Unsupported bgcode G-code encoding: ${block.encoding}`);
      continue;
    }
    try {
      const decoded = await decodeBgcodeBlockPayload(block);
      const unpacked = block.encoding === 0 ? { bytes: decoded, warnings: [] } : decodeMeatPack(decoded);
      chunks.push(new TextDecoder().decode(unpacked.bytes));
      warnings.push(...unpacked.warnings);
    } catch (error) {
      warnings.push(
        `Unable to decode bgcode G-code: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { text: chunks.join(""), warnings };
}

/**
 * Parse slicer metadata from ASCII G-code or binary bgcode.
 *
 * @param {string | ArrayBuffer | Uint8Array} input
 * @returns {Promise<{
 *   format: "gcode" | "bgcode",
 *   timestamp: string | null,
 *   durationSec: number | null,
 *   filamentGrams: number | null,
 *   filamentMm: number | null,
 *   filamentM: number | null,
 *   filamentCm3: number | null,
 *   filamentType: string | null,
 *   nozzleMm: number | null,
 *   nozzleHighFlow: boolean | null,
 *   bedTemperatureC: number | null,
 *   fillDensityPercent: number | null,
 *   nozzleTemperatureC: number | null,
 *   layerHeightMm: number | null,
 *   perimeters: number | null,
 *   objectCount: number | null,
 *   objects: object[],
 *   wipeTowerFilamentGrams: number | null,
 *   slicer: string | null,
 *   printerModel: string | null,
 *   raw: Record<string, string>,
 *   warnings: string[],
 * }>}
 */
export async function parseGcodeMeta(input) {
  if (typeof input === "string") {
    const result = createResult("gcode");
    parseTextMetadata(input, result, { commentsOnly: true });
    if (!input.trim()) result.warnings.push("G-code input is empty");
    return finalizeResult(result);
  }

  const bytes = toBytes(input);
  if (isBgcode(bytes)) {
    return parseBgcode(bytes, createResult("bgcode")).then(finalizeResult);
  }

  const result = createResult("gcode");
  parseTextMetadata(decodeTextSample(bytes), result, { commentsOnly: true });
  if (bytes.byteLength === 0) result.warnings.push("G-code input is empty");
  return finalizeResult(result);
}
