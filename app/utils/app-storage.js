/**
 * App-scoped localStorage bag for drafts, selections, and settings.
 *
 * Theme preference stays on `APP_CONFIG.themeStorageKey` and is never read or
 * written here. Clear / disable only affect this module’s meta + data keys.
 *
 * Keys: `sma1:{storageId}:meta` and `sma1:{storageId}:data`.
 */

/** Soft cap for the serialised data bag (UTF-16 code units ≈ bytes for ASCII). */
export const APP_STORAGE_DEFAULT_MAX_BYTES = 512 * 1024;

const KEY_PREFIX = "sma1";

/**
 * @typedef {{ label: string }} AppStorageKeyInfo
 * @typedef {{
 *   initialized: boolean,
 *   storageId: string | null,
 *   version: number,
 *   enabled: boolean,
 *   keys: { key: string, label: string }[],
 *   keyCount: number,
 * }} AppStorageSnapshot
 */

/** @type {string | null} */
let storageId = null;
/** @type {number} */
let storageVersion = 1;
/** @type {number} */
let maxBytes = APP_STORAGE_DEFAULT_MAX_BYTES;
/** @type {Map<string, AppStorageKeyInfo>} */
const registry = new Map();

/**
 * @returns {Storage | null}
 */
function getLocalStorage() {
  try {
    const store = globalThis.localStorage;
    if (!store || typeof store.getItem !== "function") return null;
    return store;
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @returns {{ meta: string, data: string }}
 */
export function appStorageKeysFor(id) {
  const safe = String(id);
  return {
    meta: `${KEY_PREFIX}:${safe}:meta`,
    data: `${KEY_PREFIX}:${safe}:data`,
  };
}

/**
 * @returns {boolean}
 */
function isReady() {
  return Boolean(storageId);
}

/**
 * @returns {{ meta: string, data: string } | null}
 */
function currentKeys() {
  if (!storageId) return null;
  return appStorageKeysFor(storageId);
}

/**
 * @param {string} key
 * @param {unknown} fallback
 * @returns {unknown}
 */
function readJson(key, fallback) {
  const store = getLocalStorage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (raw == null || raw === "") return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
function writeJson(key, value) {
  const store = getLocalStorage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 */
function removeKey(key) {
  const store = getLocalStorage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * @returns {{ version: number, enabled: boolean }}
 */
function readMeta() {
  const keys = currentKeys();
  if (!keys) return { version: 0, enabled: true };
  const raw = readJson(keys.meta, null);
  if (!raw || typeof raw !== "object") {
    return { version: 0, enabled: true };
  }
  const version = Number(/** @type {{ version?: unknown }} */ (raw).version);
  const enabled = /** @type {{ enabled?: unknown }} */ (raw).enabled;
  return {
    version: Number.isFinite(version) && version > 0 ? version : 0,
    enabled: enabled !== false,
  };
}

/**
 * @param {{ version: number, enabled: boolean }} meta
 * @returns {boolean}
 */
function writeMeta(meta) {
  const keys = currentKeys();
  if (!keys) return false;
  return writeJson(keys.meta, {
    version: meta.version,
    enabled: meta.enabled !== false,
  });
}

/**
 * @returns {Record<string, unknown>}
 */
function readData() {
  const keys = currentKeys();
  if (!keys) return {};
  const raw = readJson(keys.data, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return /** @type {Record<string, unknown>} */ (raw);
}

/**
 * @param {Record<string, unknown>} data
 * @returns {boolean}
 */
function writeData(data) {
  const keys = currentKeys();
  if (!keys) return false;
  let serialized;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return false;
  }
  if (serialized.length > maxBytes) return false;
  const store = getLocalStorage();
  if (!store) return false;
  try {
    store.setItem(keys.data, serialized);
    return true;
  } catch {
    return false;
  }
}

function clearDataBag() {
  const keys = currentKeys();
  if (!keys) return;
  removeKey(keys.data);
}

/**
 * Initialise (or reconfigure) the app storage bag. Call once from `initShell`.
 *
 * When stored meta `version` is lower than `storageVersion`, the data bag is
 * cleared and meta is bumped. Theme storage is never touched.
 *
 * @param {{
 *   storageId?: string,
 *   storageVersion?: number,
 *   maxBytes?: number,
 * }} [options]
 * @returns {boolean} Whether storage is active (`storageId` was non-empty)
 */
export function initAppStorage(options = {}) {
  const id =
    typeof options.storageId === "string" ? options.storageId.trim() : "";
  registry.clear();

  if (!id) {
    storageId = null;
    storageVersion = 1;
    maxBytes = APP_STORAGE_DEFAULT_MAX_BYTES;
    return false;
  }

  storageId = id;
  const ver = options.storageVersion;
  storageVersion =
    typeof ver === "number" && Number.isInteger(ver) && ver > 0 ? ver : 1;
  const mb = options.maxBytes;
  maxBytes =
    typeof mb === "number" && Number.isFinite(mb) && mb > 0
      ? mb
      : APP_STORAGE_DEFAULT_MAX_BYTES;

  const keys = currentKeys();
  const store = getLocalStorage();
  if (keys && store) {
    const hasMeta = store.getItem(keys.meta) != null;
    const hasData = store.getItem(keys.data) != null;
    if (!hasMeta && hasData) {
      clearDataBag();
    }
  }

  const meta = readMeta();
  if (meta.version < storageVersion) {
    clearDataBag();
    writeMeta({ version: storageVersion, enabled: meta.enabled });
  } else if (!meta.version) {
    writeMeta({ version: storageVersion, enabled: true });
  }

  return true;
}

/**
 * @returns {boolean}
 */
export function isAppStorageInitialized() {
  return isReady();
}

/**
 * @returns {boolean}
 */
export function isAppStorageEnabled() {
  if (!isReady()) return false;
  return readMeta().enabled;
}

/**
 * When disabled, `get` returns `undefined` and `set` / `remove` no-op.
 * Disabling also clears the data bag (theme storage is never touched).
 *
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function setAppStorageEnabled(enabled) {
  if (!isReady()) return false;
  const next = Boolean(enabled);
  if (!next) clearDataBag();
  const meta = readMeta();
  return writeMeta({
    version: meta.version || storageVersion,
    enabled: next,
  });
}

/**
 * Register a key for UI listing (footer manage menu / docs).
 *
 * @param {string} key
 * @param {{ label?: string }} [info]
 */
export function registerAppStorageKey(key, info = {}) {
  if (!key || typeof key !== "string") return;
  const label =
    typeof info.label === "string" && info.label.trim()
      ? info.label.trim()
      : key;
  registry.set(key, { label });
}

/**
 * @param {string} key
 * @returns {unknown}
 */
export function getAppStorage(key) {
  if (!isReady() || !isAppStorageEnabled()) return undefined;
  if (typeof key !== "string" || !key) return undefined;
  const data = readData();
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : undefined;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} False when disabled, oversize, unavailable, or not initialised
 */
export function setAppStorage(key, value) {
  if (!isReady() || !isAppStorageEnabled()) return false;
  if (typeof key !== "string" || !key) return false;
  const data = readData();
  data[key] = value;
  return writeData(data);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function removeAppStorage(key) {
  if (!isReady() || !isAppStorageEnabled()) return false;
  if (typeof key !== "string" || !key) return false;
  const data = readData();
  if (!Object.prototype.hasOwnProperty.call(data, key)) return true;
  delete data[key];
  return writeData(data);
}

/**
 * Clear the data bag only. Meta (version / enabled) and theme are kept.
 *
 * @returns {boolean}
 */
export function clearAppStorage() {
  if (!isReady()) return false;
  clearDataBag();
  const meta = readMeta();
  writeMeta({
    version: meta.version || storageVersion,
    enabled: meta.enabled,
  });
  return true;
}

/**
 * @returns {AppStorageSnapshot}
 */
export function getAppStorageSnapshot() {
  const enabled = isReady() ? readMeta().enabled : false;
  const data = isReady() && enabled ? readData() : {};
  const storedKeys = Object.keys(data);
  const keySet = new Set([...registry.keys(), ...storedKeys]);
  const keys = [...keySet]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      label: registry.get(key)?.label ?? key,
    }));

  return {
    initialized: isReady(),
    storageId,
    version: isReady() ? readMeta().version || storageVersion : storageVersion,
    enabled,
    keys,
    keyCount: storedKeys.length,
  };
}
