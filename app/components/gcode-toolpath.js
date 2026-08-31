/**
 * Parse G-code motion into line segments for a toolpath preview.
 *
 * This is intentionally a parser, not a slicer simulator. It supports the
 * common absolute/relative coordinate and extrusion modes and leaves advanced
 * firmware commands to the caller.
 */

import { decodeBgcodeGcode } from "./gcode.js";

const NUMBER_PATTERN = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?";
const PARAMETER_PATTERN = new RegExp(`([A-Za-z])\\s*(${NUMBER_PATTERN})`, "g");
const EPSILON = 1e-5;
const MAX_TEXT_LENGTH = 32 * 1024 * 1024;

/**
 * @param {string} command
 */
function commandCode(command) {
  const match = command.match(/^([GMT])(\d+(?:\.\d+)?)/i);
  return match ? { letter: match[1].toUpperCase(), code: Number(match[2]) } : null;
}

/**
 * @param {string} line
 */
function readCommand(line) {
  const withoutComment = line.split(";")[0].trim();
  if (!withoutComment) return null;
  const commandMatch = withoutComment.match(/^([GMT]\d+(?:\.\d+)?)/i);
  if (!commandMatch) return null;

  const command = commandCode(commandMatch[0]);
  if (!command) return null;

  const parameters = {};
  PARAMETER_PATTERN.lastIndex = commandMatch[0].length;
  for (const match of withoutComment.matchAll(PARAMETER_PATTERN)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) parameters[match[1].toUpperCase()] = value;
  }
  PARAMETER_PATTERN.lastIndex = 0;
  return { ...command, parameters };
}

/**
 * @param {number} value
 */
function isDifferent(value) {
  return Math.abs(value) > EPSILON;
}

/**
 * @param {ReturnType<typeof createToolpathResult>} result
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function extendBounds(result, x, y, z) {
  if (!result.bounds) {
    result.bounds = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z };
    return;
  }
  result.bounds.minX = Math.min(result.bounds.minX, x);
  result.bounds.minY = Math.min(result.bounds.minY, y);
  result.bounds.minZ = Math.min(result.bounds.minZ, z);
  result.bounds.maxX = Math.max(result.bounds.maxX, x);
  result.bounds.maxY = Math.max(result.bounds.maxY, y);
  result.bounds.maxZ = Math.max(result.bounds.maxZ, z);
}

function createToolpathResult() {
  return {
    segments: [],
    layerCount: 0,
    bounds: null,
    warnings: [],
  };
}

/**
 * @param {string} text
 */
function parseToolpathText(text) {
  const result = createToolpathResult();
  const state = {
    x: 0,
    y: 0,
    z: 0,
    e: 0,
    absolutePositioning: true,
    absoluteExtrusion: true,
    layer: 0,
    lastExtrusionZ: null,
  };
  const warnedCommands = new Set();

  if (text.length > MAX_TEXT_LENGTH) {
    result.warnings.push(
      `Large G-code input (${Math.round(text.length / (1024 * 1024))} MiB); parsing may use significant memory`
    );
  }

  for (const line of text.split(/\r?\n/)) {
    const command = readCommand(line);
    if (!command) continue;

    const { letter, code, parameters } = command;
    if (letter === "G" && code === 90) {
      state.absolutePositioning = true;
      continue;
    }
    if (letter === "G" && code === 91) {
      state.absolutePositioning = false;
      continue;
    }
    if (letter === "M" && code === 82) {
      state.absoluteExtrusion = true;
      continue;
    }
    if (letter === "M" && code === 83) {
      state.absoluteExtrusion = false;
      continue;
    }
    if (letter === "G" && code === 92) {
      if (parameters.X !== undefined) state.x = parameters.X;
      if (parameters.Y !== undefined) state.y = parameters.Y;
      if (parameters.Z !== undefined) state.z = parameters.Z;
      if (parameters.E !== undefined) state.e = parameters.E;
      continue;
    }
    if (letter === "G" && (code === 2 || code === 3)) {
      if (!warnedCommands.has(`G${code}`)) {
        result.warnings.push(`Arc command G${code} is not supported and was skipped`);
        warnedCommands.add(`G${code}`);
      }
      continue;
    }
    if (letter !== "G" || (code !== 0 && code !== 1)) continue;

    const from = { x: state.x, y: state.y, z: state.z };
    const next = {
      x:
        parameters.X === undefined
          ? state.x
          : state.absolutePositioning
            ? parameters.X
            : state.x + parameters.X,
      y:
        parameters.Y === undefined
          ? state.y
          : state.absolutePositioning
            ? parameters.Y
            : state.y + parameters.Y,
      z:
        parameters.Z === undefined
          ? state.z
          : state.absolutePositioning
            ? parameters.Z
            : state.z + parameters.Z,
    };

    let extrusionDelta = 0;
    if (parameters.E !== undefined) {
      extrusionDelta = state.absoluteExtrusion ? parameters.E - state.e : parameters.E;
      state.e = state.absoluteExtrusion ? parameters.E : state.e + parameters.E;
    }

    state.x = next.x;
    state.y = next.y;
    state.z = next.z;

    if (
      !isDifferent(next.x - from.x) &&
      !isDifferent(next.y - from.y) &&
      !isDifferent(next.z - from.z)
    ) {
      continue;
    }

    const extruding = extrusionDelta > EPSILON;
    if (extruding) {
      if (state.lastExtrusionZ === null) {
        state.lastExtrusionZ = next.z;
      } else if (next.z > state.lastExtrusionZ + EPSILON) {
        state.layer += 1;
        state.lastExtrusionZ = next.z;
      }
    }

    result.segments.push({
      x1: from.x,
      y1: from.y,
      z1: from.z,
      x2: next.x,
      y2: next.y,
      z2: next.z,
      layer: state.layer,
      extruding,
    });
    extendBounds(result, from.x, from.y, from.z);
    extendBounds(result, next.x, next.y, next.z);
  }

  result.layerCount = result.segments.length
    ? Math.max(...result.segments.map((segment) => segment.layer)) + 1
    : 0;
  return result;
}

/**
 * Parse ASCII G-code or bgcode into preview-ready line segments.
 *
 * @param {string | ArrayBuffer | Uint8Array} input
 * @returns {Promise<{
 *   segments: { x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, layer: number, extruding: boolean }[],
 *   layerCount: number,
 *   bounds: { minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number } | null,
 *   warnings: string[],
 * }>}
 */
export async function parseGcodeToolpath(input) {
  const decoded = await decodeBgcodeGcode(input);
  const result = parseToolpathText(decoded.text);
  result.warnings.unshift(...decoded.warnings);
  return result;
}
