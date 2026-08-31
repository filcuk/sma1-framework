import assert from "node:assert/strict";
import test from "node:test";

import { createBoxMesh, decodeStl, encodeStl } from "../app/components/stl.js";

function bounds(mesh) {
  const result = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      result.min[axis] = Math.min(result.min[axis], mesh.positions[index + axis]);
      result.max[axis] = Math.max(result.max[axis], mesh.positions[index + axis]);
    }
  }
  return result;
}

test("createBoxMesh creates an eight-vertex, twelve-triangle box", () => {
  const mesh = createBoxMesh({ width: 40, length: 20, height: 10 });

  assert.equal(mesh.positions.length, 24);
  assert.equal(mesh.indices.length, 36);
  assert.deepEqual(bounds(mesh), {
    min: [0, 0, 0],
    max: [40, 20, 10],
  });
});

test("createBoxMesh rejects invalid dimensions", () => {
  for (const dimensions of [
    { width: 0, length: 20, height: 10 },
    { width: -1, length: 20, height: 10 },
    { width: Number.NaN, length: 20, height: 10 },
    { width: 40, length: Infinity, height: 10 },
    { width: 40, length: 20, height: undefined },
  ]) {
    assert.throws(() => createBoxMesh(dimensions), TypeError);
  }
});

test("encodeStl returns the expected binary STL size", () => {
  const mesh = createBoxMesh({ width: 40, length: 20, height: 10 });
  const binary = encodeStl(mesh);

  assert.ok(binary instanceof ArrayBuffer);
  assert.equal(binary.byteLength, 84 + 50 * 12);
  assert.equal(new DataView(binary).getUint32(80, true), 12);
});

test("binary STL round-trips as a triangle mesh", () => {
  const source = createBoxMesh({ width: 40, length: 20, height: 10 });
  const decoded = decodeStl(encodeStl(source));

  assert.equal(decoded.indices.length, 36);
  assert.deepEqual(bounds(decoded), bounds(source));
  assert.deepEqual([...decoded.indices.slice(0, 6)], [0, 1, 2, 3, 4, 5]);
});

test("ASCII STL round-trips as a triangle mesh", () => {
  const source = createBoxMesh({ width: 4, length: 2, height: 1 });
  const ascii = encodeStl(source, { format: "ascii", name: "box" });
  const decoded = decodeStl(ascii);

  assert.match(ascii, /^solid box\n/);
  assert.match(ascii, /endsolid box\n$/);
  assert.equal((ascii.match(/facet normal/g) ?? []).length, 12);
  assert.equal(decoded.indices.length, 36);
  assert.deepEqual(bounds(decoded), bounds(source));
});

test("encodeStl rejects malformed or degenerate meshes", () => {
  assert.throws(
    () => encodeStl({ positions: [0, 0, 0], indices: [0, 1, 2] }),
    RangeError
  );
  assert.throws(
    () =>
      encodeStl({
        positions: [0, 0, 0, 1, 0, 0, 2, 0, 0],
        indices: [0, 1, 2],
      }),
    TypeError
  );
  assert.throws(
    () =>
      encodeStl(
        { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
        { format: "ply" }
      ),
    TypeError
  );
});

test("decodeStl rejects truncated input", () => {
  const truncated = new ArrayBuffer(84);
  new DataView(truncated).setUint32(80, 1, true);
  assert.throws(() => decodeStl(truncated), RangeError);
  assert.throws(() => decodeStl("solid empty\nendsolid empty\n"), TypeError);
});
