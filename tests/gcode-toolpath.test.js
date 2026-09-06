import assert from "node:assert/strict";
import test from "node:test";

import { parseGcodeToolpath } from "../app/components/gcode-toolpath.js";

const textEncoder = new TextEncoder();

function buildBgcodeGcode(text) {
  const payload = textEncoder.encode(text);
  const file = new Uint8Array(10 + 8 + 2 + payload.length);
  const view = new DataView(file.buffer);
  view.setUint32(0, 0x45444347, true); // GCDE
  view.setUint32(4, 1, true);
  view.setUint16(8, 0, true); // no block checksums
  view.setUint16(10, 1, true); // G-code block
  view.setUint16(12, 0, true); // no compression
  view.setUint32(14, payload.length, true);
  view.setUint16(18, 0, true); // no G-code encoding
  file.set(payload, 20);
  return file;
}

test("parses an absolute square and calculates bounds", async () => {
  const result = await parseGcodeToolpath(
    [
      "G90",
      "M82",
      "G1 Z0.2",
      "G1 X10 E1",
      "G1 Y10 E2",
      "G1 X0 E3",
      "G1 Y0 E4",
    ].join("\n")
  );

  assert.equal(result.segments.length, 5);
  assert.equal(result.segments.filter((segment) => segment.extruding).length, 4);
  assert.equal(result.layerCount, 1);
  assert.deepEqual(result.bounds, {
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 10,
    maxY: 10,
    maxZ: 0.2,
  });
});

test("handles relative positioning, relative extrusion, and G92", async () => {
  const result = await parseGcodeToolpath(
    [
      "M83",
      "G1 X1 E0.5",
      "G1 X2 E-0.2",
      "G91",
      "G1 X1 E0.5",
      "G92 E0",
      "G1 X1 E0.5",
    ].join("\n")
  );

  assert.deepEqual(
    result.segments.map((segment) => ({
      x1: segment.x1,
      x2: segment.x2,
      extruding: segment.extruding,
    })),
    [
      { x1: 0, x2: 1, extruding: true },
      { x1: 1, x2: 2, extruding: false },
      { x1: 2, x2: 3, extruding: true },
      { x1: 3, x2: 4, extruding: true },
    ]
  );
});

test("detects layers from increasing Z on extrusion moves", async () => {
  const result = await parseGcodeToolpath(
    ["M83", "G1 Z0.2", "G1 X10 E1", "G1 Z0.4", "G1 X20 E1"].join("\n")
  );

  assert.deepEqual(
    result.segments.map((segment) => segment.layer),
    [0, 0, 0, 1]
  );
  assert.equal(result.layerCount, 2);
});

test("parses an uncompressed bgcode G-code block", async () => {
  const result = await parseGcodeToolpath(
    buildBgcodeGcode("G1 X10 Y10 E0.2\n")
  );

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].extruding, true);
  assert.equal(result.segments[0].x2, 10);
  assert.equal(result.segments[0].y2, 10);
  assert.deepEqual(result.warnings, []);
});

test("keeps compact E parameters separate from X or Y values", async () => {
  const result = await parseGcodeToolpath("G0X235\nG0X225E4");

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[1].x2, 225);
  assert.equal(result.segments[1].extruding, true);
  assert.deepEqual(result.bounds, {
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 235,
    maxY: 0,
    maxZ: 0,
  });
});

test("tessellates G2/G3 arcs with I/J offsets", async () => {
  const result = await parseGcodeToolpath(
    ["G90", "G1 X10 Y0", "G2 X0 Y10 I-10 J0", "G3 X10 Y0 I0 J-10"].join("\n")
  );

  assert.ok(result.segments.length > 2);
  const last = result.segments.at(-1);
  assert.ok(last);
  assert.ok(Math.abs(last.x2 - 10) < 1e-6);
  assert.ok(Math.abs(last.y2 - 0) < 1e-6);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.bounds);
  assert.ok(result.bounds.minX < 1);
  assert.ok(result.bounds.maxY > 9);
});

test("tessellates R-mode arcs and helical Z", async () => {
  const result = await parseGcodeToolpath(
    ["G90", "G1 X10 Y0 Z0", "G3 X0 Y10 Z2 R10"].join("\n")
  );

  assert.ok(result.segments.length >= 4);
  const last = result.segments.at(-1);
  assert.ok(last);
  assert.ok(Math.abs(last.x2 - 0) < 1e-6);
  assert.ok(Math.abs(last.y2 - 10) < 1e-6);
  assert.ok(Math.abs(last.z2 - 2) < 1e-6);
  assert.deepEqual(result.warnings, []);
});

test("warns for unsupported arc planes without dropping the endpoint", async () => {
  const result = await parseGcodeToolpath(
    ["G18", "G1 X0 Z0", "G2 X10 Z0 I5 K0", "G17", "G1 X20"].join("\n")
  );

  assert.equal(result.warnings.includes("unsupported geometry"), true);
  assert.equal(result.segments.some((segment) => segment.x2 === 20), true);
});

test("warns once for invalid arc parameters", async () => {
  const result = await parseGcodeToolpath("G2 X10 Y10\nG3 X0 Y0 R1");

  assert.deepEqual(result.warnings, ["unsupported geometry"]);
});
