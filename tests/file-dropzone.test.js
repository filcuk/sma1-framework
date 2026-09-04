import test from "node:test";
import assert from "node:assert/strict";
import {
  fileMatchesAccept,
  parseAcceptTokens,
  resolveAcceptFilter,
} from "../app/components/file-dropzone.js";

test("parseAcceptTokens splits and normalises accept lists", () => {
  assert.deepEqual(parseAcceptTokens(".gcode,.bgcode"), [".gcode", ".bgcode"]);
  assert.deepEqual(parseAcceptTokens(" image/* ,  text/plain "), [
    "image/*",
    "text/plain",
  ]);
  assert.deepEqual(parseAcceptTokens(""), []);
  assert.deepEqual(parseAcceptTokens(null), []);
});

test("fileMatchesAccept allows every file when accept is empty", () => {
  assert.equal(fileMatchesAccept({ name: "any.bin", type: "" }, ""), true);
  assert.equal(fileMatchesAccept({ name: "any.bin", type: "" }, []), true);
});

test("fileMatchesAccept matches extension tokens on the final extension", () => {
  assert.equal(
    fileMatchesAccept({ name: "box.gcode", type: "" }, ".gcode,.bgcode"),
    true
  );
  assert.equal(
    fileMatchesAccept({ name: "BOX.BGCODE", type: "" }, ".gcode,.bgcode"),
    true
  );
  assert.equal(
    fileMatchesAccept({ name: "notes.txt", type: "text/plain" }, ".gcode,.bgcode"),
    false
  );
  assert.equal(
    fileMatchesAccept({ name: "fake.xgcode", type: "" }, ".gcode"),
    false
  );
  assert.equal(
    fileMatchesAccept({ name: "archive.tar.gz", type: "" }, ".tar.gz"),
    true
  );
});

test("fileMatchesAccept matches MIME tokens and wildcards", () => {
  assert.equal(
    fileMatchesAccept({ name: "a.png", type: "image/png" }, "image/*"),
    true
  );
  assert.equal(
    fileMatchesAccept({ name: "a.txt", type: "text/plain" }, "image/*"),
    false
  );
  assert.equal(
    fileMatchesAccept({ name: "a.json", type: "application/json" }, "application/json"),
    true
  );
  assert.equal(
    fileMatchesAccept({ name: "a.bin", type: "" }, "image/*"),
    false
  );
});

test("resolveAcceptFilter defaults to strict and accepts soft", () => {
  assert.equal(resolveAcceptFilter(undefined), "strict");
  assert.equal(resolveAcceptFilter(""), "strict");
  assert.equal(resolveAcceptFilter("strict"), "strict");
  assert.equal(resolveAcceptFilter("SOFT"), "soft");
});
