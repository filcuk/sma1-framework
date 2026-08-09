/**
 * Hex color input with an inline swatch preview.
 *
 * Markup:
 *   <div class="color-input" data-color-input-default="#0969da">
 *     <label class="field-label" for="my-color-input">Colour</label>
 *     <div class="color-input-control">
 *       <input type="text" id="my-color-input" class="input color-input-field"
 *         autocomplete="off" spellcheck="false" aria-label="Hex colour" />
 *       <span class="color-input-swatch" aria-hidden="true"></span>
 *       <input type="hidden" class="color-input-value" name="color" />
 *     </div>
 *   </div>
 *
 * data-color-input-default — initial hex value (#RGB / #RRGGBB; with alpha also #RGBA / #RRGGBBAA)
 * data-color-input-alpha — allow 4- and 8-digit hex with alpha
 * data-color-input-disabled — disable the control
 */

import { parseBooleanAttr } from "../utils/dom.js";
import { parseHexColor } from "../utils/color.js";

export { parseHexColor };

const PARTIAL_HEX_OPAQUE_PATTERN = /^#?[0-9a-fA-F]{0,6}$/;
const PARTIAL_HEX_ALPHA_PATTERN = /^#?[0-9a-fA-F]{0,8}$/;

function formatDisplayValue(value) {
  return value ?? "";
}

function isPartialHexInput(value, alpha) {
  const pattern = alpha ? PARTIAL_HEX_ALPHA_PATTERN : PARTIAL_HEX_OPAQUE_PATTERN;
  return pattern.test(String(value ?? "").trim());
}

function resolveDisabled(colorInputEl, disabledOption) {
  if (typeof disabledOption === "boolean") return disabledOption;
  return parseBooleanAttr(colorInputEl?.dataset.colorInputDisabled) ?? false;
}

function resolveAlpha(colorInputEl, alphaOption) {
  if (typeof alphaOption === "boolean") return alphaOption;
  return parseBooleanAttr(colorInputEl?.dataset.colorInputAlpha) ?? false;
}

function syncSwatch(swatchEl, color) {
  if (!swatchEl) return;
  swatchEl.classList.toggle("is-empty", !color);
  if (color) {
    swatchEl.style.setProperty("--color-input-preview", color);
  } else {
    swatchEl.style.removeProperty("--color-input-preview");
  }
}

export function initColorInput(
  colorInputEl,
  { defaultValue, alpha, disabled, onChange, onInput } = {}
) {
  if (!colorInputEl) return null;

  const textInput = colorInputEl.querySelector(".color-input-field");
  const hiddenInput = colorInputEl.querySelector(".color-input-value");
  const swatchEl = colorInputEl.querySelector(".color-input-swatch");

  if (!textInput || !swatchEl) return null;

  const allowAlpha = resolveAlpha(colorInputEl, alpha);
  colorInputEl.classList.toggle("color-input--alpha", allowAlpha);

  const parse = (value) => parseHexColor(value, { alpha: allowAlpha });

  const initialRaw =
    defaultValue ??
    colorInputEl.dataset.colorInputDefault ??
    hiddenInput?.value ??
    textInput.value;
  let currentValue = parse(initialRaw);
  let isEditing = false;
  let isDisabled = resolveDisabled(colorInputEl, disabled);

  function buildPayload(source) {
    return {
      colorInputEl,
      value: currentValue,
      display: formatDisplayValue(currentValue),
      source,
    };
  }

  function applyDisabled(nextDisabled) {
    isDisabled = nextDisabled;
    colorInputEl.classList.toggle("color-input--disabled", nextDisabled);
    textInput.disabled = nextDisabled;
  }

  applyDisabled(isDisabled);

  function syncDom({ emit = true, source = "init" } = {}) {
    if (!isEditing) {
      textInput.value = formatDisplayValue(currentValue);
    }
    if (hiddenInput) {
      hiddenInput.value = currentValue ?? "";
    }
    syncSwatch(swatchEl, currentValue);

    if (emit) {
      onChange?.(buildPayload(source));
    }
  }

  function setValue(nextValue, { emit = true, source = "api" } = {}) {
    const parsed =
      nextValue === "" || nextValue === null || nextValue === undefined
        ? null
        : parse(nextValue);
    if (nextValue && !parsed) return false;
    currentValue = parsed;
    isEditing = false;
    textInput.removeAttribute("aria-invalid");
    syncDom({ emit, source });
    return true;
  }

  function commitTypedValue({ emit = true } = {}) {
    const raw = String(textInput.value).trim();
    if (!raw) {
      currentValue = null;
      isEditing = false;
      textInput.removeAttribute("aria-invalid");
      syncDom({ emit, source: "input" });
      return true;
    }

    const parsed = parse(raw);
    if (!parsed) {
      textInput.value = formatDisplayValue(currentValue);
      textInput.removeAttribute("aria-invalid");
      isEditing = false;
      syncSwatch(swatchEl, currentValue);
      return false;
    }

    currentValue = parsed;
    isEditing = false;
    textInput.removeAttribute("aria-invalid");
    syncDom({ emit, source: "input" });
    return true;
  }

  textInput.addEventListener("focus", () => {
    isEditing = true;
  });

  textInput.addEventListener("input", () => {
    if (isDisabled) return;
    isEditing = true;
    const raw = String(textInput.value).trim();

    if (!raw) {
      textInput.removeAttribute("aria-invalid");
      syncSwatch(swatchEl, null);
      onInput?.({
        ...buildPayload("input"),
        value: null,
        display: "",
      });
      return;
    }

    if (!isPartialHexInput(raw, allowAlpha)) {
      textInput.setAttribute("aria-invalid", "true");
      syncSwatch(swatchEl, null);
      return;
    }

    textInput.removeAttribute("aria-invalid");
    const preview = parse(raw);
    syncSwatch(swatchEl, preview);
    onInput?.({
      ...buildPayload("input"),
      value: preview,
      display: raw,
    });
  });

  textInput.addEventListener("change", () => {
    commitTypedValue();
  });

  textInput.addEventListener("blur", () => {
    commitTypedValue();
  });

  textInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTypedValue();
      textInput.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      isEditing = false;
      textInput.value = formatDisplayValue(currentValue);
      textInput.removeAttribute("aria-invalid");
      syncSwatch(swatchEl, currentValue);
      textInput.blur();
    }
  });

  syncDom({ emit: Boolean(onChange) });

  return {
    getValue() {
      return currentValue;
    },
    setValue(nextValue) {
      return setValue(nextValue);
    },
    commitInput() {
      return commitTypedValue();
    },
    setDisabled(nextDisabled) {
      applyDisabled(Boolean(nextDisabled));
    },
    isDisabled() {
      return isDisabled;
    },
    allowsAlpha() {
      return allowAlpha;
    },
  };
}

/** Wire every `.color-input` block in `root`. */
export function initColorInputs(root = document) {
  const instances = [];
  root.querySelectorAll(".color-input").forEach((colorInputEl) => {
    const instance = initColorInput(colorInputEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
