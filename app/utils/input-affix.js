/**
 * Input adornments: display-only muted prefix/suffix (units), uppercase
 * transform, and fixed decimal formatting. Does not set `aria-invalid` —
 * compose with `field-validation.js` when needed.
 *
 * Value stays bare (e.g. `12.50`); unit chrome is not part of the string.
 */

import { parseBooleanAttr } from "./dom.js";

/** @type {WeakMap<HTMLElement, InputAffixApi>} */
const apiByControl = new WeakMap();

/**
 * @typedef {{
 *   control: HTMLInputElement | HTMLTextAreaElement,
 *   shell: HTMLElement | null,
 *   setPrefix: (text: string) => void,
 *   setSuffix: (text: string) => void,
 *   setUppercase: (enabled: boolean) => void,
 *   setDecimals: (decimals: number | null) => void,
 *   sync: () => void,
 *   destroy: () => void,
 * }} InputAffixApi
 */

/**
 * Format a numeric string to a fixed fraction length.
 * Non-finite / empty input returns null (caller leaves the value alone).
 * @param {string} value
 * @param {number} [decimals=2]
 * @returns {string | null}
 */
export function formatFixedDecimals(value, decimals = 2) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  const places = Math.max(0, Math.min(20, Math.floor(Number(decimals)) || 0));
  return num.toFixed(places);
}

/**
 * Default placeholder for a fixed-decimal field (e.g. `0.00`).
 * @param {number} [decimals=2]
 * @returns {string}
 */
export function decimalPlaceholder(decimals = 2) {
  const places = Math.max(0, Math.min(20, Math.floor(Number(decimals)) || 0));
  return places === 0 ? "0" : `0.${"0".repeat(places)}`;
}

/**
 * @param {HTMLElement} host
 * @returns {HTMLInputElement | HTMLTextAreaElement | null}
 */
function resolveControl(host) {
  if (
    host instanceof HTMLInputElement ||
    host instanceof HTMLTextAreaElement
  ) {
    return host;
  }
  const nested = host.querySelector("input.input, textarea.textarea, .input");
  return nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement
    ? nested
    : null;
}

/**
 * @param {HTMLElement} el
 * @param {string} name
 * @returns {string}
 */
function readData(el, name) {
  return el.getAttribute(name) ?? "";
}

/**
 * @param {HTMLElement | null | undefined} host
 * @param {{
 *   prefix?: string,
 *   suffix?: string,
 *   uppercase?: boolean,
 *   decimals?: number | null,
 * }} [options]
 * @returns {InputAffixApi | null}
 */
export function initInputAffix(host, options = {}) {
  if (!(host instanceof HTMLElement)) return null;

  const control = resolveControl(host);
  if (!control) return null;

  const existing = apiByControl.get(control);
  if (existing) {
    if (options.prefix !== undefined) existing.setPrefix(options.prefix);
    if (options.suffix !== undefined) existing.setSuffix(options.suffix);
    if (options.uppercase !== undefined) existing.setUppercase(options.uppercase);
    if (options.decimals !== undefined) existing.setDecimals(options.decimals);
    else existing.sync();
    return existing;
  }

  const field =
    host.classList.contains("field") ? host : control.closest(".field");

  let prefix =
    options.prefix !== undefined
      ? String(options.prefix)
      : readData(control, "data-input-prefix") ||
        (field instanceof HTMLElement ? readData(field, "data-input-prefix") : "");
  let suffix =
    options.suffix !== undefined
      ? String(options.suffix)
      : readData(control, "data-input-suffix") ||
        (field instanceof HTMLElement ? readData(field, "data-input-suffix") : "");

  const uppercaseAttr =
    control.hasAttribute("data-input-uppercase")
      ? control.getAttribute("data-input-uppercase")
      : field instanceof HTMLElement && field.hasAttribute("data-input-uppercase")
        ? field.getAttribute("data-input-uppercase")
        : undefined;
  let uppercase =
    options.uppercase !== undefined
      ? Boolean(options.uppercase)
      : uppercaseAttr !== undefined
        ? parseBooleanAttr(uppercaseAttr) !== false
        : false;

  const decimalsAttr = control.hasAttribute("data-input-decimals")
    ? control.getAttribute("data-input-decimals")
    : field instanceof HTMLElement && field.hasAttribute("data-input-decimals")
      ? field.getAttribute("data-input-decimals")
      : null;
  /** @type {number | null} */
  let decimals =
    options.decimals !== undefined
      ? options.decimals
      : decimalsAttr !== null
        ? decimalsAttr === "" || decimalsAttr === "true"
          ? 2
          : Number(decimalsAttr)
        : null;
  if (decimals !== null && !Number.isFinite(decimals)) decimals = 2;

  let destroyed = false;
  /** @type {HTMLElement | null} */
  let shell = control.closest(".input-affix");
  /** @type {HTMLElement | null} */
  let prefixEl = null;
  /** @type {HTMLElement | null} */
  let suffixEl = null;

  const ensureShell = () => {
    if (!prefix && !suffix) return;
    if (!shell) {
      shell = document.createElement("div");
      shell.className = "input-affix";
      shell.dataset.inputAffixOwned = "true";
      control.before(shell);
      shell.append(control);
    }
    shell.classList.toggle("input-affix--prefix", Boolean(prefix));
    shell.classList.toggle("input-affix--suffix", Boolean(suffix));
  };

  const syncUnits = () => {
    ensureShell();
    if (!shell) {
      prefixEl?.remove();
      suffixEl?.remove();
      prefixEl = null;
      suffixEl = null;
      return;
    }

    if (prefix) {
      if (!prefixEl) {
        prefixEl = document.createElement("span");
        prefixEl.className = "input-affix-prefix";
        prefixEl.setAttribute("aria-hidden", "true");
        shell.prepend(prefixEl);
      }
      prefixEl.textContent = prefix;
    } else if (prefixEl) {
      prefixEl.remove();
      prefixEl = null;
    }

    if (suffix) {
      if (!suffixEl) {
        suffixEl = document.createElement("span");
        suffixEl.className = "input-affix-suffix";
        suffixEl.setAttribute("aria-hidden", "true");
        shell.append(suffixEl);
      }
      suffixEl.textContent = suffix;
    } else if (suffixEl) {
      suffixEl.remove();
      suffixEl = null;
    }

    shell.classList.toggle("input-affix--prefix", Boolean(prefix));
    shell.classList.toggle("input-affix--suffix", Boolean(suffix));

    if (!prefix && !suffix && shell.dataset.inputAffixOwned === "true") {
      shell.before(control);
      shell.remove();
      shell = null;
      prefixEl = null;
      suffixEl = null;
    }
  };

  const applyUppercase = () => {
    if (!uppercase) return;
    const next = control.value.toUpperCase();
    if (next !== control.value) {
      const start = control.selectionStart;
      const end = control.selectionEnd;
      control.value = next;
      if (start !== null && end !== null && control.type !== "number") {
        try {
          control.setSelectionRange(start, end);
        } catch {
          /* some input types reject selection */
        }
      }
    }
  };

  const applyDecimalsPlaceholder = () => {
    if (decimals === null) return;
    if (!control.placeholder) {
      control.placeholder = decimalPlaceholder(decimals);
    }
  };

  const commitDecimals = () => {
    if (decimals === null) return;
    const formatted = formatFixedDecimals(control.value, decimals);
    if (formatted !== null) control.value = formatted;
  };

  const onInput = () => {
    applyUppercase();
  };

  const onBlur = () => {
    commitDecimals();
  };

  control.addEventListener("input", onInput);
  control.addEventListener("blur", onBlur);

  const sync = () => {
    if (destroyed) return;
    syncUnits();
    applyUppercase();
    applyDecimalsPlaceholder();
  };

  sync();

  /** @type {InputAffixApi} */
  const api = {
    control,
    get shell() {
      return shell;
    },
    setPrefix: (text) => {
      prefix = String(text ?? "");
      syncUnits();
    },
    setSuffix: (text) => {
      suffix = String(text ?? "");
      syncUnits();
    },
    setUppercase: (enabled) => {
      uppercase = Boolean(enabled);
      applyUppercase();
    },
    setDecimals: (next) => {
      decimals =
        next === null || next === undefined
          ? null
          : Number.isFinite(Number(next))
            ? Number(next)
            : 2;
      applyDecimalsPlaceholder();
      commitDecimals();
    },
    sync,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      control.removeEventListener("input", onInput);
      control.removeEventListener("blur", onBlur);
      if (shell?.dataset.inputAffixOwned === "true") {
        shell.before(control);
        shell.remove();
      }
      shell = null;
      prefixEl = null;
      suffixEl = null;
      apiByControl.delete(control);
    },
  };

  apiByControl.set(control, api);
  return api;
}

/**
 * Wire every control/field with adornment data attributes under `root`.
 * @param {ParentNode} [root=document]
 * @returns {InputAffixApi[]}
 */
export function initInputAffixes(root = document) {
  /** @type {Set<HTMLElement>} */
  const hosts = new Set();

  const attrs = [
    "[data-input-prefix]",
    "[data-input-suffix]",
    "[data-input-uppercase]",
    "[data-input-decimals]",
  ];

  root.querySelectorAll(attrs.join(",")).forEach((el) => {
    if (el instanceof HTMLElement) hosts.add(el);
  });

  return [...hosts]
    .map((host) => initInputAffix(host))
    .filter(Boolean);
}
