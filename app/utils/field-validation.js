/**
 * Simple field validation: built-in presets + custom rules.
 * Drives `aria-invalid` and optional `.field-error` / `[data-field-error]` copy.
 *
 * Empty optional fields skip format rules. Format checks run after blur (default)
 * or when `validate()` / `validateField()` is called. Required emptiness flags
 * immediately when `.is-required` or a `required` rule is present.
 *
 * Do not also call `initRequiredField` on the same field — this module owns
 * `aria-invalid` when wired.
 */

import { setHidden } from "./dom.js";
import {
  isRequiredControlEmpty,
  resolveRequiredControl,
} from "./required-field.js";

/** @type {WeakMap<HTMLElement, FieldValidationApi>} */
const apiByField = new WeakMap();

/**
 * @typedef {(
 *   value: string,
 *   ctx: FieldValidationContext
 * ) => boolean | string} FieldValidator
 */

/**
 * @typedef {{
 *   field: HTMLElement,
 *   control: HTMLElement | null,
 *   min?: number,
 *   max?: number,
 * }} FieldValidationContext
 */

/**
 * @typedef {{
 *   field: HTMLElement,
 *   getControl: () => HTMLElement | null,
 *   validate: () => boolean,
 *   isValid: () => boolean,
 *   sync: () => void,
 *   setRules: (rules: Array<string | FieldValidator>) => void,
 *   destroy: () => void,
 * }} FieldValidationApi
 */

/** @type {Map<string, FieldValidator>} */
const validators = new Map();

const DEFAULT_MESSAGES = {
  required: "Required",
  email: "Enter an email address",
  number: "Enter a number",
  noSpaces: "Must not contain spaces",
  alphanumeric: "Use letters and numbers only",
};

/**
 * @param {string} name
 * @param {FieldValidator} fn
 */
export function registerValidator(name, fn) {
  const key = String(name || "").trim();
  if (!key || typeof fn !== "function") return;
  validators.set(key, fn);
}

/**
 * @param {string} name
 * @returns {FieldValidator | undefined}
 */
export function getValidator(name) {
  return validators.get(String(name || "").trim());
}

/**
 * @param {string | null | undefined} attr
 * @returns {string[]}
 */
export function parseValidateList(attr) {
  if (attr === null || attr === undefined || attr === "") return [];
  return String(attr)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @param {HTMLElement | null | undefined} control
 * @returns {string}
 */
export function getControlValue(control) {
  if (!(control instanceof HTMLElement)) return "";
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    return control.value;
  }
  if ("value" in control && typeof control.value === "string") {
    return control.value;
  }
  const dataValue = control.getAttribute("data-value");
  if (dataValue !== null) return dataValue;
  return "";
}

/**
 * @param {string} value
 * @param {Array<string | FieldValidator>} rules
 * @param {FieldValidationContext} ctx
 * @returns {{ valid: boolean, message: string }}
 */
export function evaluateRules(value, rules, ctx) {
  for (const rule of rules) {
    const isRequiredRule = rule === "required";
    // Empty optional / non-required rules: skip (custom fns included).
    if (!isRequiredRule && value.trim() === "") continue;

    if (typeof rule === "function") {
      const result = runRule(rule, value, ctx);
      if (!result.valid) return result;
      continue;
    }

    const name = String(rule || "").trim();
    const fn = validators.get(name);
    if (!fn) continue;
    const result = runRule(fn, value, ctx);
    if (!result.valid) {
      return {
        valid: false,
        message: result.message || DEFAULT_MESSAGES[name] || "Invalid",
      };
    }
  }

  return { valid: true, message: "" };
}

/**
 * @param {FieldValidator | undefined} fn
 * @param {string} value
 * @param {FieldValidationContext} ctx
 * @returns {{ valid: boolean, message: string }}
 */
function runRule(fn, value, ctx) {
  if (typeof fn !== "function") return { valid: true, message: "" };
  const raw = fn(value, ctx);
  if (raw === true) return { valid: true, message: "" };
  if (raw === false) return { valid: false, message: "" };
  if (typeof raw === "string") {
    const message = raw.trim();
    return message
      ? { valid: false, message }
      : { valid: false, message: "" };
  }
  return { valid: true, message: "" };
}

registerValidator("required", (value) => {
  if (value.trim() === "") return DEFAULT_MESSAGES.required;
  return true;
});

registerValidator("email", (value) => {
  if (value.trim() === "") return true;
  if (!value.includes("@")) return DEFAULT_MESSAGES.email;
  return true;
});

registerValidator("number", (value, ctx) => {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return DEFAULT_MESSAGES.number;
  if (ctx.min !== undefined && num < ctx.min) {
    return ctx.max !== undefined
      ? `Must be between ${ctx.min} and ${ctx.max}`
      : `Must be at least ${ctx.min}`;
  }
  if (ctx.max !== undefined && num > ctx.max) {
    return ctx.min !== undefined
      ? `Must be between ${ctx.min} and ${ctx.max}`
      : `Must be at most ${ctx.max}`;
  }
  return true;
});

registerValidator("noSpaces", (value) => {
  if (value.trim() === "") return true;
  if (/\s/.test(value)) return DEFAULT_MESSAGES.noSpaces;
  return true;
});

registerValidator("alphanumeric", (value) => {
  if (value.trim() === "") return true;
  if (!/^[A-Za-z0-9]*$/.test(value)) return DEFAULT_MESSAGES.alphanumeric;
  return true;
});

/**
 * @param {HTMLElement | null | undefined} control
 * @returns {boolean}
 */
function isControlActive(control) {
  if (!(control instanceof HTMLElement)) return false;
  if (
    (control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLButtonElement) &&
    control.disabled
  ) {
    return false;
  }
  if (control.getAttribute("aria-disabled") === "true") return false;
  if (control.closest("[hidden], .hidden")) return false;
  return true;
}

/**
 * @param {HTMLElement} field
 * @returns {HTMLElement | null}
 */
function resolveErrorHost(field) {
  const marked = field.querySelector("[data-field-error]");
  if (marked instanceof HTMLElement) return marked;
  const byClass = field.querySelector(".field-error");
  return byClass instanceof HTMLElement ? byClass : null;
}

/**
 * @param {HTMLElement} field
 * @param {HTMLElement | null} control
 * @returns {{ min?: number, max?: number }}
 */
function readBounds(field, control) {
  const minRaw =
    control?.getAttribute("data-validate-min") ??
    field.getAttribute("data-validate-min");
  const maxRaw =
    control?.getAttribute("data-validate-max") ??
    field.getAttribute("data-validate-max");
  /** @type {{ min?: number, max?: number }} */
  const bounds = {};
  if (minRaw !== null && minRaw !== undefined && minRaw !== "") {
    const min = Number(minRaw);
    if (Number.isFinite(min)) bounds.min = min;
  }
  if (maxRaw !== null && maxRaw !== undefined && maxRaw !== "") {
    const max = Number(maxRaw);
    if (Number.isFinite(max)) bounds.max = max;
  }
  return bounds;
}

/**
 * @param {HTMLElement} control
 * @param {string} [message]
 * @param {HTMLElement | null} [field]
 */
export function setFieldInvalid(control, message = "", field = null) {
  if (!(control instanceof HTMLElement)) return;
  control.setAttribute("aria-invalid", "true");
  const host = field instanceof HTMLElement ? field : control.closest(".field");
  if (!(host instanceof HTMLElement)) return;
  const errorEl = resolveErrorHost(host);
  if (!(errorEl instanceof HTMLElement)) return;
  if (message) errorEl.textContent = message;
  setHidden(errorEl, !message);
  linkDescribedBy(control, errorEl, Boolean(message));
}

/**
 * @param {HTMLElement} control
 * @param {HTMLElement | null} [field]
 */
export function clearFieldInvalid(control, field = null) {
  if (!(control instanceof HTMLElement)) return;
  control.removeAttribute("aria-invalid");
  const host = field instanceof HTMLElement ? field : control.closest(".field");
  if (!(host instanceof HTMLElement)) return;
  const errorEl = resolveErrorHost(host);
  if (!(errorEl instanceof HTMLElement)) return;
  errorEl.textContent = "";
  setHidden(errorEl, true);
  linkDescribedBy(control, errorEl, false);
}

/**
 * @param {HTMLElement} control
 * @param {HTMLElement} errorEl
 * @param {boolean} link
 */
function linkDescribedBy(control, errorEl, link) {
  if (!errorEl.id) {
    errorEl.id = `field-error-${Math.random().toString(36).slice(2, 10)}`;
  }
  const current = (control.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((id) => id !== errorEl.id);
  if (link) current.push(errorEl.id);
  if (current.length) control.setAttribute("aria-describedby", current.join(" "));
  else control.removeAttribute("aria-describedby");
}

/**
 * @param {HTMLElement} field
 * @param {{
 *   control?: HTMLElement | null,
 *   rules?: Array<string | FieldValidator>,
 *   checkFormat?: boolean,
 *   nativeRequired?: boolean,
 * }} [options]
 * @returns {boolean}
 */
export function validateField(field, options = {}) {
  if (!(field instanceof HTMLElement)) return true;

  const control = resolveRequiredControl(field, options.control ?? null);
  const rules = resolveRules(field, options.rules);
  const checkFormat = options.checkFormat !== false;

  if (!(control instanceof HTMLElement) || !isControlActive(control)) {
    if (control instanceof HTMLElement) clearFieldInvalid(control, field);
    return true;
  }

  const value = getControlValue(control);
  const bounds = readBounds(field, control);
  const ctx = { field, control, ...bounds };
  const hasRequired = rules.some((rule) => rule === "required");
  const activeRules = checkFormat
    ? rules
    : rules.filter((rule) => rule === "required");

  const result = evaluateRules(value, activeRules, ctx);

  syncRequiredAttrs(field, control, hasRequired, options.nativeRequired);

  if (!result.valid) {
    setFieldInvalid(control, result.message, field);
    return false;
  }

  clearFieldInvalid(control, field);
  return true;
}

/**
 * @param {HTMLElement} field
 * @param {Array<string | FieldValidator> | undefined} explicit
 * @returns {Array<string | FieldValidator>}
 */
function resolveRules(field, explicit) {
  /** @type {Array<string | FieldValidator>} */
  const rules = [];
  const seen = new Set();

  const add = (rule) => {
    if (typeof rule === "function") {
      rules.push(rule);
      return;
    }
    const name = String(rule || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    rules.push(name);
  };

  if (Array.isArray(explicit) && explicit.length) {
    explicit.forEach(add);
  } else {
    parseValidateList(field.getAttribute("data-validate")).forEach(add);
    const control = resolveRequiredControl(field);
    if (control) {
      parseValidateList(control.getAttribute("data-validate")).forEach(add);
    }
  }

  if (field.classList.contains("is-required")) add("required");

  return rules;
}

/**
 * @param {HTMLElement} field
 * @param {HTMLElement} control
 * @param {boolean} required
 * @param {boolean} [nativeRequired]
 */
function syncRequiredAttrs(field, control, required, nativeRequired = true) {
  if (required) field.classList.add("is-required");

  if (!required || !isControlActive(control)) {
    control.removeAttribute("aria-required");
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement
    ) {
      control.removeAttribute("required");
    }
    return;
  }

  control.setAttribute("aria-required", "true");
  if (
    nativeRequired !== false &&
    (control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement)
  ) {
    control.setAttribute("required", "");
  }
}

/**
 * @param {HTMLElement | null | undefined} field
 * @param {{
 *   control?: HTMLElement | null,
 *   rules?: Array<string | FieldValidator>,
 *   validateOn?: "blur" | "change" | "input",
 *   nativeRequired?: boolean,
 * }} [options]
 * @returns {FieldValidationApi | null}
 */
export function initFieldValidation(field, options = {}) {
  if (!(field instanceof HTMLElement)) return null;

  const existing = apiByField.get(field);
  if (existing) {
    if (options.rules) existing.setRules(options.rules);
    else existing.sync();
    return existing;
  }

  let destroyed = false;
  /** @type {Array<string | FieldValidator>} */
  let rules = resolveRules(field, options.rules);
  /** @type {HTMLElement | null} */
  let boundControl = null;
  /** @type {(() => void) | null} */
  let unbind = null;
  let formatRevealed = false;

  const validateOn = options.validateOn || "blur";

  const getControl = () =>
    resolveRequiredControl(field, options.control ?? null);

  const sync = ({ forceFormat = false } = {}) => {
    if (destroyed) return true;
    const checkFormat = forceFormat || formatRevealed || validateOn === "input";
    return validateField(field, {
      control: getControl(),
      rules,
      checkFormat,
      nativeRequired: options.nativeRequired,
    });
  };

  const bind = () => {
    const control = getControl();
    if (control === boundControl) return;
    unbind?.();
    boundControl = control;
    if (!(control instanceof HTMLElement)) {
      unbind = null;
      return;
    }

    const onInput = () => {
      if (validateOn === "input") formatRevealed = true;
      sync();
    };
    const onChange = () => {
      if (validateOn === "change") formatRevealed = true;
      sync();
    };
    const onBlur = () => {
      formatRevealed = true;
      sync({ forceFormat: true });
    };

    control.addEventListener("input", onInput);
    control.addEventListener("change", onChange);
    control.addEventListener("blur", onBlur);
    unbind = () => {
      control.removeEventListener("input", onInput);
      control.removeEventListener("change", onChange);
      control.removeEventListener("blur", onBlur);
    };
  };

  bind();
  // Required empty flags immediately; format waits for blur unless validateOn is input.
  sync({ forceFormat: false });

  /** @type {FieldValidationApi} */
  const api = {
    field,
    getControl,
    validate: () => {
      formatRevealed = true;
      return sync({ forceFormat: true });
    },
    isValid: () => {
      const control = getControl();
      if (!(control instanceof HTMLElement) || !isControlActive(control)) return true;
      const value = getControlValue(control);
      const bounds = readBounds(field, control);
      const result = evaluateRules(value, rules, {
        field,
        control,
        ...bounds,
      });
      return result.valid;
    },
    sync: () => {
      bind();
      sync();
    },
    setRules: (nextRules) => {
      rules = resolveRules(field, nextRules);
      sync();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      unbind?.();
      unbind = null;
      const control = boundControl;
      boundControl = null;
      if (control) clearFieldInvalid(control, field);
      apiByField.delete(field);
    },
  };

  apiByField.set(field, api);
  return api;
}

/**
 * Wire every `.field[data-validate]` (and controls with `data-validate` inside a `.field`) under `root`.
 * @param {ParentNode} [root=document]
 * @param {{ validateOn?: "blur" | "change" | "input", nativeRequired?: boolean }} [options]
 * @returns {FieldValidationApi[]}
 */
export function initFieldValidations(root = document, options = {}) {
  /** @type {Set<HTMLElement>} */
  const fields = new Set();

  root.querySelectorAll(".field[data-validate]").forEach((el) => {
    if (el instanceof HTMLElement) fields.add(el);
  });

  root.querySelectorAll("[data-validate]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const field = el.closest(".field");
    if (field instanceof HTMLElement) fields.add(field);
  });

  return [...fields]
    .map((field) =>
      initFieldValidation(field, {
        validateOn: options.validateOn,
        nativeRequired: options.nativeRequired,
      })
    )
    .filter(Boolean);
}

// Re-export emptiness helper for apps that combine checks.
export { isRequiredControlEmpty, resolveRequiredControl };
