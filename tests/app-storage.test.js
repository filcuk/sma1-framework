import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  APP_STORAGE_DEFAULT_MAX_BYTES,
  appStorageKeysFor,
  clearAppStorage,
  getAppStorage,
  getAppStorageSnapshot,
  initAppStorage,
  isAppStorageEnabled,
  isAppStorageInitialized,
  registerAppStorageKey,
  removeAppStorage,
  setAppStorage,
  setAppStorageEnabled,
} from "../app/utils/app-storage.js";

/** @returns {Storage} */
function createMemoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
  initAppStorage({ storageId: "test-app", storageVersion: 1 });
});

describe("app-storage", () => {
  it("builds namespaced meta and data keys", () => {
    assert.deepEqual(appStorageKeysFor("demo"), {
      meta: "sma1:demo:meta",
      data: "sma1:demo:data",
    });
  });

  it("round-trips values when enabled", () => {
    assert.equal(setAppStorage("draft", { text: "hello" }), true);
    assert.deepEqual(getAppStorage("draft"), { text: "hello" });
    assert.equal(isAppStorageInitialized(), true);
    assert.equal(isAppStorageEnabled(), true);
  });

  it("no-ops writes and hides reads when disabled", () => {
    assert.equal(setAppStorage("sel", "a"), true);
    assert.equal(setAppStorageEnabled(false), true);
    assert.equal(isAppStorageEnabled(), false);
    assert.equal(getAppStorage("sel"), undefined);
    assert.equal(setAppStorage("sel", "b"), false);
    assert.equal(setAppStorageEnabled(true), true);
    assert.equal(getAppStorage("sel"), undefined);
  });

  it("disabling clears stored data", () => {
    setAppStorage("keep", 1);
    assert.equal(setAppStorageEnabled(false), true);
    assert.equal(getAppStorageSnapshot().keyCount, 0);
    assert.equal(setAppStorageEnabled(true), true);
    assert.equal(getAppStorage("keep"), undefined);
  });

  it("clear removes data but keeps enabled meta", () => {
    setAppStorage("a", 1);
    setAppStorage("b", 2);
    assert.equal(clearAppStorage(), true);
    assert.equal(getAppStorage("a"), undefined);
    assert.equal(isAppStorageEnabled(), true);
    const { meta } = appStorageKeysFor("test-app");
    assert.ok(globalThis.localStorage.getItem(meta));
  });

  it("remove deletes a single key", () => {
    setAppStorage("keep", 1);
    setAppStorage("drop", 2);
    assert.equal(removeAppStorage("drop"), true);
    assert.equal(getAppStorage("keep"), 1);
    assert.equal(getAppStorage("drop"), undefined);
  });

  it("clears data when storageVersion increases", () => {
    setAppStorage("legacy", true);
    initAppStorage({ storageId: "test-app", storageVersion: 2 });
    assert.equal(getAppStorage("legacy"), undefined);
    assert.equal(getAppStorageSnapshot().version, 2);
  });

  it("clears orphan data when meta is missing", () => {
    const { data } = appStorageKeysFor("test-app");
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem(data, JSON.stringify({ orphan: 1 }));
    initAppStorage({ storageId: "test-app", storageVersion: 1 });
    assert.equal(getAppStorage("orphan"), undefined);
  });

  it("refuses oversized payloads", () => {
    initAppStorage({
      storageId: "test-app",
      storageVersion: 1,
      maxBytes: 32,
    });
    assert.equal(setAppStorage("big", "x".repeat(100)), false);
    assert.equal(getAppStorage("big"), undefined);
    assert.equal(APP_STORAGE_DEFAULT_MAX_BYTES, 512 * 1024);
  });

  it("does not touch unrelated localStorage keys (e.g. theme)", () => {
    globalThis.localStorage.setItem("microapp-theme", "dark");
    setAppStorage("x", 1);
    clearAppStorage();
    assert.equal(globalThis.localStorage.getItem("microapp-theme"), "dark");
  });

  it("snapshot lists registered labels and stored key count", () => {
    registerAppStorageKey("draft", { label: "Draft code" });
    setAppStorage("draft", "hi");
    setAppStorage("extra", 1);
    const snap = getAppStorageSnapshot();
    assert.equal(snap.keyCount, 2);
    assert.deepEqual(
      snap.keys.find((k) => k.key === "draft"),
      { key: "draft", label: "Draft code" }
    );
    assert.ok(snap.keys.some((k) => k.key === "extra" && k.label === "extra"));
  });

  it("init without storageId leaves storage inactive", () => {
    initAppStorage({});
    assert.equal(isAppStorageInitialized(), false);
    assert.equal(setAppStorage("x", 1), false);
    assert.equal(getAppStorage("x"), undefined);
  });
});
