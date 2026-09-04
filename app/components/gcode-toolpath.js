/**
 * Parse G-code motion into line segments for a toolpath preview.
 *
 * This is intentionally a parser, not a slicer simulator. It supports the
 * common absolute/relative coordinate and extrusion modes, linear moves, and
 * XY-plane arcs (G2 / G3 with I/J or R). Advanced firmware commands and
 * non-XY arc planes are reported rather than simulated.
 */

import { decodeBgcodeGcode } from "./gcode.js";

const NUMBER_PATTERN = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?";
const PARAMETER_PATTERN = new RegExp(`([A-Za-z])\\s*(${NUMBER_PATTERN})`, "g");
const EPSILON = 1e-5;
const MAX_TEXT_LENGTH = 32 * 1024 * 1024;
const ARC_CHORD_ERROR_MM = 0.05;
const ARC_MIN_SEGMENTS = 4;
const ARC_MAX_SEGMENTS = 360;
const UNSUPPORTED_GEOMETRY_WARNING = "unsupported geometry";

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
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 */
function distance2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
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
 * @param {ReturnType<typeof createToolpathResult>} result
 */
function noteUnsupportedGeometry(result) {
  if (!result.warnings.includes(UNSUPPORTED_GEOMETRY_WARNING)) {
    result.warnings.push(UNSUPPORTED_GEOMETRY_WARNING);
  }
}

/**
 * @param {number} startAngle
 * @param {number} endAngle
 * @param {boolean} clockwise
 * @param {boolean} fullCircle
 */
function arcSweep(startAngle, endAngle, clockwise, fullCircle) {
  if (fullCircle) return clockwise ? -Math.PI * 2 : Math.PI * 2;

  let delta = endAngle - startAngle;
  if (clockwise) {
    while (delta >= -EPSILON) delta -= Math.PI * 2;
    if (delta > -EPSILON) delta = -Math.PI * 2;
  } else {
    while (delta <= EPSILON) delta += Math.PI * 2;
    if (delta < EPSILON) delta = Math.PI * 2;
  }
  return delta;
}

/**
 * @param {number} radius
 * @param {number} sweep
 */
function arcSegmentCount(radius, sweep) {
  const absSweep = Math.abs(sweep);
  if (!(absSweep > EPSILON) || !(radius > EPSILON)) return 0;
  const safeRadius = Math.max(radius, ARC_CHORD_ERROR_MM);
  const maxStep = 2 * Math.acos(
    Math.max(-1, Math.min(1, 1 - ARC_CHORD_ERROR_MM / safeRadius))
  );
  const count = Math.ceil(absSweep / Math.max(maxStep, EPSILON));
  return Math.min(ARC_MAX_SEGMENTS, Math.max(ARC_MIN_SEGMENTS, count));
}

/**
 * Resolve XY arc centre from I/J offsets or R radius.
 *
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number }} to
 * @param {Record<string, number>} parameters
 * @param {boolean} clockwise
 * @returns {{ cx: number, cy: number, radius: number, fullCircle: boolean } | null}
 */
function resolveXyArcCentre(from, to, parameters, clockwise) {
  const hasOffset =
    parameters.I !== undefined ||
    parameters.J !== undefined ||
    parameters.K !== undefined;
  const hasRadius = parameters.R !== undefined;

  if (hasOffset && hasRadius) return null;

  const samePoint =
    !isDifferent(to.x - from.x) && !isDifferent(to.y - from.y);

  if (hasOffset) {
    if (parameters.K !== undefined && isDifferent(parameters.K)) return null;
    const i = parameters.I ?? 0;
    const j = parameters.J ?? 0;
    if (!isDifferent(i) && !isDifferent(j)) return null;
    const cx = from.x + i;
    const cy = from.y + j;
    const radius = distance2(from.x, from.y, cx, cy);
    if (!(radius > EPSILON)) return null;
    const endRadius = distance2(to.x, to.y, cx, cy);
    if (isDifferent(endRadius - radius) && Math.abs(endRadius - radius) > 0.5) {
      return null;
    }
    return { cx, cy, radius, fullCircle: samePoint };
  }

  if (!hasRadius) return null;
  if (samePoint) return null;

  const r = parameters.R;
  if (!Number.isFinite(r) || !isDifferent(r)) return null;

  const chord = distance2(from.x, from.y, to.x, to.y);
  if (!(chord > EPSILON)) return null;

  const absR = Math.abs(r);
  if (absR * 2 + EPSILON < chord) return null;

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const halfChord = chord / 2;
  const offset = Math.sqrt(Math.max(0, absR * absR - halfChord * halfChord));
  const ux = (to.x - from.x) / chord;
  const uy = (to.y - from.y) / chord;
  // Perpendicular in XY; sign picks the centre for short/long arc vs CW/CCW.
  const px = -uy;
  const py = ux;

  // Positive R → shorter arc; negative R → longer arc.
  // For a given centre side, CW vs CCW is determined by the command.
  const shortArc = r > 0;
  // Centre on the left of start→end is CCW for the short arc.
  let side = shortArc ? 1 : -1;
  if (clockwise) side = -side;

  return {
    cx: midX + px * offset * side,
    cy: midY + py * offset * side,
    radius: absR,
    fullCircle: false,
  };
}

/**
 * @param {object} state
 * @param {Record<string, number>} parameters
 */
function resolveTarget(state, parameters) {
  return {
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
}

/**
 * @param {object} state
 * @param {Record<string, number>} parameters
 */
function applyExtrusion(state, parameters) {
  let extrusionDelta = 0;
  if (parameters.E !== undefined) {
    extrusionDelta = state.absoluteExtrusion
      ? parameters.E - state.e
      : parameters.E;
    state.e = state.absoluteExtrusion
      ? parameters.E
      : state.e + parameters.E;
  }
  return extrusionDelta;
}

/**
 * @param {object} state
 * @param {number} z
 * @param {boolean} extruding
 */
function updateLayer(state, z, extruding) {
  if (!extruding) return;
  if (state.lastExtrusionZ === null) {
    state.lastExtrusionZ = z;
  } else if (z > state.lastExtrusionZ + EPSILON) {
    state.layer += 1;
    state.lastExtrusionZ = z;
  }
}

/**
 * @param {ReturnType<typeof createToolpathResult>} result
 * @param {object} state
 * @param {{ x: number, y: number, z: number }} from
 * @param {{ x: number, y: number, z: number }} to
 * @param {boolean} extruding
 */
function pushSegment(result, state, from, to, extruding) {
  if (
    !isDifferent(to.x - from.x) &&
    !isDifferent(to.y - from.y) &&
    !isDifferent(to.z - from.z)
  ) {
    return;
  }

  updateLayer(state, to.z, extruding);
  result.segments.push({
    x1: from.x,
    y1: from.y,
    z1: from.z,
    x2: to.x,
    y2: to.y,
    z2: to.z,
    layer: state.layer,
    extruding,
  });
  extendBounds(result, from.x, from.y, from.z);
  extendBounds(result, to.x, to.y, to.z);
}

/**
 * @param {ReturnType<typeof createToolpathResult>} result
 * @param {object} state
 * @param {{ x: number, y: number, z: number }} from
 * @param {{ x: number, y: number, z: number }} to
 * @param {Record<string, number>} parameters
 * @param {boolean} clockwise
 * @param {boolean} extruding
 * @returns {boolean} whether the arc was tessellated
 */
function appendXyArc(result, state, from, to, parameters, clockwise, extruding) {
  const centre = resolveXyArcCentre(from, to, parameters, clockwise);
  if (!centre) return false;

  const startAngle = Math.atan2(from.y - centre.cy, from.x - centre.cx);
  const endAngle = Math.atan2(to.y - centre.cy, to.x - centre.cx);
  const sweep = arcSweep(startAngle, endAngle, clockwise, centre.fullCircle);
  const count = arcSegmentCount(centre.radius, sweep);
  if (count < 1) return false;

  let prev = { ...from };
  for (let i = 1; i <= count; i += 1) {
    const t = i / count;
    const angle = startAngle + sweep * t;
    const point = {
      x: centre.cx + centre.radius * Math.cos(angle),
      y: centre.cy + centre.radius * Math.sin(angle),
      z: from.z + (to.z - from.z) * t,
    };
    if (i === count) {
      point.x = to.x;
      point.y = to.y;
      point.z = to.z;
    }
    pushSegment(result, state, prev, point, extruding);
    prev = point;
  }
  return true;
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
    /** @type {17 | 18 | 19} */
    plane: 17,
    layer: 0,
    lastExtrusionZ: null,
  };

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
    if (letter === "G" && (code === 17 || code === 18 || code === 19)) {
      state.plane = /** @type {17 | 18 | 19} */ (code);
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
      const from = { x: state.x, y: state.y, z: state.z };
      const next = resolveTarget(state, parameters);
      const extrusionDelta = applyExtrusion(state, parameters);
      const extruding = extrusionDelta > EPSILON;
      const clockwise = code === 2;

      state.x = next.x;
      state.y = next.y;
      state.z = next.z;

      if (state.plane !== 17) {
        noteUnsupportedGeometry(result);
        continue;
      }

      const tessellated = appendXyArc(
        result,
        state,
        from,
        next,
        parameters,
        clockwise,
        extruding
      );
      if (!tessellated) {
        noteUnsupportedGeometry(result);
      }
      continue;
    }

    if (letter !== "G" || (code !== 0 && code !== 1)) continue;

    const from = { x: state.x, y: state.y, z: state.z };
    const next = resolveTarget(state, parameters);
    const extrusionDelta = applyExtrusion(state, parameters);
    const extruding = extrusionDelta > EPSILON;

    state.x = next.x;
    state.y = next.y;
    state.z = next.z;

    pushSegment(result, state, from, next, extruding);
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

export { UNSUPPORTED_GEOMETRY_WARNING };
