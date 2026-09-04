/**
 * Small, dependency-free STL mesh and export helpers.
 *
 * Mesh coordinates use millimetres by convention. STL itself does not store
 * units, so callers should keep that convention when consuming the output.
 *
 * Mesh shape:
 *   {
 *     positions: Float32Array, // x, y, z triplets
 *     indices: Uint32Array,    // indexed triangles
 *   }
 *
 * The binary encoder expands indexed triangles into STL's non-indexed
 * triangle records and computes outward-facing normals from winding.
 */

import { downloadFile } from "./file-download.js";

const BINARY_HEADER_BYTES = 80;
const BINARY_COUNT_BYTES = 4;
const BINARY_TRIANGLE_BYTES = 50;
const BINARY_PREFIX_BYTES = BINARY_HEADER_BYTES + BINARY_COUNT_BYTES;
const DEFAULT_NAME = "model";
const STL_MIME_TYPE = "model/stl";

/**
 * @param {number} value
 * @param {string} name
 */
function assertPositiveDimension(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite number greater than zero`);
  }
}

/**
 * Create an axis-aligned box with its minimum corner at the origin.
 *
 * @param {{ width: number, length: number, height: number }} dimensions
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function createBoxMesh({ width, length, height } = {}) {
  assertPositiveDimension(width, "width");
  assertPositiveDimension(length, "length");
  assertPositiveDimension(height, "height");

  const positions = new Float32Array([
    0,
    0,
    0,
    width,
    0,
    0,
    width,
    length,
    0,
    0,
    length,
    0,
    0,
    0,
    height,
    width,
    0,
    height,
    width,
    length,
    height,
    0,
    length,
    height,
  ]);

  // Outward-facing winding: bottom, top, front, right, back, left.
  const indices = new Uint32Array([
    0,
    2,
    1,
    0,
    3,
    2,
    4,
    5,
    6,
    4,
    6,
    7,
    0,
    1,
    5,
    0,
    5,
    4,
    1,
    2,
    6,
    1,
    6,
    5,
    2,
    3,
    7,
    2,
    7,
    6,
    3,
    0,
    4,
    3,
    4,
    7,
  ]);

  return { positions, indices };
}

/**
 * @param {unknown} mesh
 */
function validateMesh(mesh) {
  if (!mesh || typeof mesh !== "object") {
    throw new TypeError("mesh must be an object");
  }

  const positions = /** @type {{ positions?: unknown }} */ (mesh).positions;
  const indices = /** @type {{ indices?: unknown }} */ (mesh).indices;

  if (!positions || typeof positions.length !== "number" || positions.length % 3 !== 0) {
    throw new TypeError("mesh.positions must contain x, y, z triplets");
  }
  if (!indices || typeof indices.length !== "number" || indices.length % 3 !== 0) {
    throw new TypeError("mesh.indices must contain triangle triplets");
  }

  for (const value of positions) {
    if (!Number.isFinite(value)) {
      throw new TypeError("mesh.positions must contain only finite numbers");
    }
  }

  const vertexCount = positions.length / 3;
  for (const value of indices) {
    if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
      throw new RangeError("mesh.indices contains an out-of-range vertex index");
    }
  }

  return { positions, indices };
}

/**
 * @param {ArrayLike<number>} positions
 * @param {number} index
 */
function readPosition(positions, index) {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} c
 */
function computeNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
  if (magnitude === 0) {
    throw new TypeError("mesh contains a degenerate triangle");
  }
  return normal.map((value) => value / magnitude);
}

/**
 * @param {string} value
 */
function safeName(value) {
  const name = String(value ?? DEFAULT_NAME).replace(/[^\w.-]+/g, "_");
  return name || DEFAULT_NAME;
}

/**
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {number} triangle
 */
function readTriangle(positions, indices, triangle) {
  const offset = triangle * 3;
  const a = readPosition(positions, indices[offset]);
  const b = readPosition(positions, indices[offset + 1]);
  const c = readPosition(positions, indices[offset + 2]);
  return { a, b, c, normal: computeNormal(a, b, c) };
}

/**
 * @param {ReturnType<typeof readTriangle>} triangle
 */
function formatAsciiTriangle(triangle) {
  const formatPoint = (point) => point.map((value) => String(value)).join(" ");
  return [
    `  facet normal ${triangle.normal.map((value) => String(value)).join(" ")}`,
    "    outer loop",
    `      vertex ${formatPoint(triangle.a)}`,
    `      vertex ${formatPoint(triangle.b)}`,
    `      vertex ${formatPoint(triangle.c)}`,
    "    endloop",
    "  endfacet",
  ].join("\n");
}

/**
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {string} name
 */
function encodeAscii(positions, indices, name) {
  const triangles = [];
  for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
    triangles.push(formatAsciiTriangle(readTriangle(positions, indices, triangle)));
  }
  return [`solid ${safeName(name)}`, ...triangles, `endsolid ${safeName(name)}`, ""].join("\n");
}

/**
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {string} name
 */
function encodeBinary(positions, indices, name) {
  const triangleCount = indices.length / 3;
  const buffer = new ArrayBuffer(BINARY_PREFIX_BYTES + triangleCount * BINARY_TRIANGLE_BYTES);
  const bytes = new Uint8Array(buffer, 0, BINARY_HEADER_BYTES);
  const header = new TextEncoder().encode(`SMA1 Framework STL ${safeName(name)}`);
  bytes.set(header.subarray(0, BINARY_HEADER_BYTES));

  const view = new DataView(buffer);
  view.setUint32(BINARY_HEADER_BYTES, triangleCount, true);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const recordOffset = BINARY_PREFIX_BYTES + triangle * BINARY_TRIANGLE_BYTES;
    const record = readTriangle(positions, indices, triangle);
    const values = [...record.normal, ...record.a, ...record.b, ...record.c];
    values.forEach((value, index) => {
      view.setFloat32(recordOffset + index * 4, value, true);
    });
    view.setUint16(recordOffset + 48, 0, true);
  }

  return buffer;
}

/**
 * Encode an indexed triangle mesh as STL.
 *
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} mesh
 * @param {{ format?: "binary" | "ascii", name?: string }} [options]
 * @returns {ArrayBuffer | string}
 */
export function encodeStl(mesh, { format = "binary", name = DEFAULT_NAME } = {}) {
  const { positions, indices } = validateMesh(mesh);
  if (format === "ascii") return encodeAscii(positions, indices, name);
  if (format === "binary") return encodeBinary(positions, indices, name);
  throw new TypeError(`Unsupported STL format: ${format}`);
}

/**
 * @param {ArrayBuffer | Uint8Array} input
 */
function asDataView(input) {
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (input instanceof Uint8Array) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("binary STL input must be an ArrayBuffer or Uint8Array");
}

/**
 * @param {ArrayBuffer | Uint8Array} input
 */
function decodeBinary(input) {
  const view = asDataView(input);
  if (view.byteLength < BINARY_PREFIX_BYTES) {
    throw new RangeError("binary STL is truncated");
  }

  const triangleCount = view.getUint32(BINARY_HEADER_BYTES, true);
  const expectedLength = BINARY_PREFIX_BYTES + triangleCount * BINARY_TRIANGLE_BYTES;
  if (view.byteLength < expectedLength) {
    throw new RangeError("binary STL is truncated");
  }

  const positions = new Float32Array(triangleCount * 9);
  const indices = new Uint32Array(triangleCount * 3);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const recordOffset = BINARY_PREFIX_BYTES + triangle * BINARY_TRIANGLE_BYTES;
    const positionOffset = triangle * 9;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const sourceOffset = recordOffset + 12 + vertex * 12;
      positions[positionOffset + vertex * 3] = view.getFloat32(sourceOffset, true);
      positions[positionOffset + vertex * 3 + 1] = view.getFloat32(sourceOffset + 4, true);
      positions[positionOffset + vertex * 3 + 2] = view.getFloat32(sourceOffset + 8, true);
      indices[triangle * 3 + vertex] = triangle * 3 + vertex;
    }
  }

  return { positions, indices };
}

const NUMBER_PATTERN = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
const ASCII_FACET_PATTERN = new RegExp(
  `facet\\s+normal\\s+${NUMBER_PATTERN}\\s+${NUMBER_PATTERN}\\s+${NUMBER_PATTERN}` +
    `\\s+outer\\s+loop\\s+vertex\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})` +
    `\\s+vertex\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})` +
    `\\s+vertex\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})` +
    "\\s+endloop\\s+endfacet",
  "gi"
);

/**
 * @param {string} input
 */
function decodeAscii(input) {
  const values = [];
  let match;
  while ((match = ASCII_FACET_PATTERN.exec(input)) !== null) {
    for (let index = 1; index <= 9; index += 1) {
      values.push(Number(match[index]));
    }
  }
  ASCII_FACET_PATTERN.lastIndex = 0;

  if (!values.length || values.length % 9 !== 0) {
    throw new TypeError("ASCII STL contains no complete facets");
  }

  const positions = new Float32Array(values);
  const indices = new Uint32Array((values.length / 3));
  for (let index = 0; index < indices.length; index += 1) {
    indices[index] = index;
  }
  return { positions, indices };
}

/**
 * Decode an STL into a non-indexed triangle mesh.
 *
 * @param {string | ArrayBuffer | Uint8Array} input
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function decodeStl(input) {
  if (typeof input === "string") return decodeAscii(input);
  return decodeBinary(input);
}

/**
 * Encode and download an STL file in the browser.
 *
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} mesh
 * @param {{ filename?: string, format?: "binary" | "ascii", name?: string }} [options]
 */
export function downloadStl(
  mesh,
  { filename = "model.stl", format = "binary", name = DEFAULT_NAME } = {}
) {
  const content = encodeStl(mesh, { format, name });
  return downloadFile({
    filename,
    content,
    mimeType: STL_MIME_TYPE,
  });
}
