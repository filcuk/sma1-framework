/**
 * Required field chrome: `.field.is-required` label asterisk (CSS) plus
 * `aria-invalid` / `aria-required` / optional native `required` on the control
 * while the value is empty.
 *
 * Empty required fields show the error border immediately (same pattern as
 * connection-string-creator). Hidden or disabled controls are not flagged.
 */

/** @type {WeakMap<HTMLElement, RequiredFieldApi>} */
const apiByField = new WeakMap();

/**
 * @typedef {{
 *   field: HTMLElement,
 *   getControl: () => HTMLElement | null,
 *   isRequired: () => boolean,
 *   setRequired: (required: boolean) => void,
 *   sync: () => void,
 *   destroy: () => void,
 * }} RequiredFieldApi
 */

/**
 * @param {HTMLElement | null | undefined} control
 * @returns {boolean}
 */
export function isRequiredControlEmpty(control) {
  if (!(control instanceof HTMLElement)) return true;
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    return control.value.trim() === "";
  }
  if ("value" in control && typeof control.value === "string") {
    return control.value.trim() === "";
  }
  const dataValue = control.getAttribute("data-value");
  if (dataValue !== null) return dataValue.trim() === "";
  return false;
}

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
 * Resolve the control to validate inside a `.field`.
 * @param {HTMLElement} field
 * @param {HTMLElement | null} [explicit]
 * @returns {HTMLElement | null}
 */
export function resolveRequiredControl(field, explicit = null) {
  if (explicit instanceof HTMLElement) return explicit;

  const marked = field.querySelector("[data-required-control]");
  if (marked instanceof HTMLElement) return marked;

  if (field instanceof HTMLLabelElement && field.htmlFor) {
    const byId = document.getElementById(field.htmlFor);
    if (byId instanceof HTMLElement) return byId;
  }

  const labeled = field.querySelector(
    "textarea.textarea, input.input, select.input, .combobox-input, .textarea, .input"
  );
  if (labeled instanceof HTMLElement) return labeled;

  return null;
}

/**
 * Apply required / invalid attributes for the current value.
 * @param {HTMLElement} field
 * @param {{
 *   required?: boolean,
 *   control?: HTMLElement | null,
 *   nativeRequired?: boolean,
 *   isEmpty?: (control: HTMLElement) => boolean,
 * }} [options]
 */
export function syncRequiredField(field, options = {}) {
  if (!(field instanceof HTMLElement)) return;

  const required =
    options.required !== undefined
      ? Boolean(options.required)
      : field.classList.contains("is-required");
  const nativeRequired = options.nativeRequired !== false;
  const control = resolveRequiredControl(field, options.control ?? null);
  const emptyFn = options.isEmpty ?? isRequiredControlEmpty;

  field.classList.toggle("is-required", required);

  if (!(control instanceof HTMLElement)) return;

  if (!required || !isControlActive(control)) {
    control.removeAttribute("aria-required");
    control.removeAttribute("aria-invalid");
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
    nativeRequired &&
    (control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement)
  ) {
    control.setAttribute("required", "");
  }

  if (emptyFn(control)) control.setAttribute("aria-invalid", "true");
  else control.removeAttribute("aria-invalid");
}

/**
 * Wire one `.field` for required / empty invalid sync.
 * @param {HTMLElement | null | undefined} field
 * @param {{
 *   required?: boolean,
 *   control?: HTMLElement | null,
 *   nativeRequired?: boolean,
 *   isEmpty?: (control: HTMLElement) => boolean,
 * }} [options]
 * @returns {RequiredFieldApi | null}
 */
export function initRequiredField(field, options = {}) {
  if (!(field instanceof HTMLElement)) return null;

  const existing = apiByField.get(field);
  if (existing) {
    if (options.required !== undefined) existing.setRequired(options.required);
    else existing.sync();
    return existing;
  }

  let destroyed = false;
  /** @type {HTMLElement | null} */
  let boundControl = null;
  /** @type {(() => void) | null} */
  let unbind = null;

  const getControl = () =>
    resolveRequiredControl(field, options.control ?? null);

  const sync = () => {
    if (destroyed) return;
    syncRequiredField(field, {
      required: field.classList.contains("is-required"),
      control: getControl(),
      nativeRequired: options.nativeRequired,
      isEmpty: options.isEmpty,
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
    const onUpdate = () => sync();
    control.addEventListener("input", onUpdate);
    control.addEventListener("change", onUpdate);
    unbind = () => {
      control.removeEventListener("input", onUpdate);
      control.removeEventListener("change", onUpdate);
    };
  };

  /**
   * @param {boolean} required
   */
  const setRequired = (required) => {
    field.classList.toggle("is-required", required);
    bind();
    sync();
  };

  if (options.required !== undefined) {
    field.classList.toggle("is-required", Boolean(options.required));
  } else if (!field.classList.contains("is-required")) {
    field.classList.add("is-required");
  }

  bind();
  sync();

  /** @type {RequiredFieldApi} */
  const api = {
    field,
    getControl,
    isRequired: () => field.classList.contains("is-required"),
    setRequired,
    sync: () => {
      bind();
      sync();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      unbind?.();
      unbind = null;
      boundControl = null;
      apiByField.delete(field);
    },
  };

  apiByField.set(field, api);
  return api;
}

/**
 * Toggle required state on a field (creates listeners on first call).
 * @param {HTMLElement | null | undefined} field
 * @param {boolean} required
 * @param {{ control?: HTMLElement | null, nativeRequired?: boolean, isEmpty?: (control: HTMLElement) => boolean }} [options]
 * @returns {RequiredFieldApi | null}
 */
export function setFieldRequired(field, required, options = {}) {
  if (!(field instanceof HTMLElement)) return null;
  const api = initRequiredField(field, { ...options, required });
  api?.setRequired(required);
  return api;
}

/**
 * Wire every `.field.is-required` under `root`.
 * @param {ParentNode} [root=document]
 * @param {{ nativeRequired?: boolean }} [options]
 * @returns {RequiredFieldApi[]}
 */
export function initRequiredFields(root = document, options = {}) {
  return [...root.querySelectorAll(".field.is-required")]
    .map((el) =>
      el instanceof HTMLElement
        ? initRequiredField(el, {
            nativeRequired: options.nativeRequired,
          })
        : null
    )
    .filter(Boolean);
}
