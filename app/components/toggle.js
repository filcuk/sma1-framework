/**
 * On/off switch control (optional tri-state / mixed).
 *
 * Markup:
 *   <div class="toggle" data-toggle-default="false">
 *     <button type="button" class="toggle-btn" role="switch" aria-checked="false">
 *       <span class="toggle-track" aria-hidden="true">
 *         <span class="toggle-thumb">
 *           <span data-icon="check" data-icon-class="toggle-thumb-icon toggle-thumb-icon--on" aria-hidden="true"></span>
 *         </span>
 *       </span>
 *       <span class="toggle-label">Notifications</span>
 *     </button>
 *     <input type="hidden" class="toggle-value" />
 *   </div>
 *
 * Tri-state (`data-toggle-tristate`): cycles off → on → mixed. Uses
 * `role="checkbox"` with `aria-checked="mixed"` (ARIA switch is boolean-only).
 * Include a `remove` (minus) icon with `.toggle-thumb-icon--mixed`, or one is
 * injected automatically.
 *
 * data-toggle-default — "true" / "false" / "mixed" (tristate), or presence for on
 * data-toggle-tristate — enable three-state cycling
 * data-toggle-disabled — disable the switch
 *
 * Add `.toggle--slim` for a thin track with an oversized overhanging thumb
 * (no icon; CSS hides thumb icons if present).
 */

import { parseBooleanAttr } from "../utils/dom.js";
import { initIcons } from "../utils/icons.js";

/** @typedef {"true" | "false" | "mixed"} ToggleState */

const TRI_STATES = /** @type {const} */ (["false", "true", "mixed"]);

/**
 * @param {unknown} value
 * @param {boolean} allowMixed
 * @returns {ToggleState}
 */
function normalizeState(value, allowMixed) {
  if (allowMixed && (value === "mixed" || value === "indeterminate")) {
    return "mixed";
  }
  if (value === true || value === "true" || value === "") return "true";
  if (value === false || value === "false") return "false";
  return "false";
}

/**
 * @param {ToggleState} state
 * @returns {ToggleState}
 */
function nextTriState(state) {
  const index = TRI_STATES.indexOf(state);
  return TRI_STATES[(index + 1) % TRI_STATES.length];
}

function resolveDisabled(toggleEl, disabledOption, toggleBtn) {
  if (typeof disabledOption === "boolean") return disabledOption;
  if (parseBooleanAttr(toggleEl?.dataset.toggleDisabled)) return true;
  return toggleBtn.disabled;
}

/**
 * @param {HTMLElement} toggleEl
 * @param {boolean | string | undefined} defaultStateOption
 * @param {boolean} isTristate
 * @returns {ToggleState}
 */
function resolveDefaultState(toggleEl, defaultStateOption, isTristate) {
  if (defaultStateOption !== undefined) {
    return normalizeState(defaultStateOption, isTristate);
  }
  const fromAttr = toggleEl?.dataset.toggleDefault;
  if (fromAttr !== undefined) {
    return normalizeState(fromAttr, isTristate);
  }
  const hiddenInput = toggleEl.querySelector(".toggle-value");
  if (hiddenInput?.value) {
    return normalizeState(hiddenInput.value, isTristate);
  }
  const btn = toggleEl.querySelector(".toggle-btn");
  const aria = btn?.getAttribute("aria-checked");
  if (aria) return normalizeState(aria, isTristate);
  return "false";
}

/**
 * Ensure mixed-state minus icon exists in the thumb for tristate toggles.
 * @param {HTMLElement} toggleBtn
 */
function ensureMixedIcon(toggleBtn) {
  const thumb = toggleBtn.querySelector(".toggle-thumb");
  if (!thumb) return;

  const onIcon = thumb.querySelector(".toggle-thumb-icon--on, [data-icon='check']");
  if (onIcon && !onIcon.classList.contains("toggle-thumb-icon--on")) {
    onIcon.classList.add("toggle-thumb-icon", "toggle-thumb-icon--on");
  }

  if (thumb.querySelector(".toggle-thumb-icon--mixed, [data-icon='remove']")) {
    return;
  }

  const mixed = document.createElement("span");
  mixed.dataset.icon = "remove";
  mixed.dataset.iconClass = "toggle-thumb-icon toggle-thumb-icon--mixed";
  mixed.setAttribute("aria-hidden", "true");
  thumb.append(mixed);
}

export function initToggle(
  toggleEl,
  { defaultChecked, defaultState, disabled, tristate, onChange } = {}
) {
  if (!toggleEl) return null;

  const toggleBtn = toggleEl.querySelector(".toggle-btn");
  const hiddenInput = toggleEl.querySelector(".toggle-value");

  if (!toggleBtn) return null;

  const isTristate =
    typeof tristate === "boolean"
      ? tristate
      : Boolean(parseBooleanAttr(toggleEl.dataset.toggleTristate));

  const role = toggleBtn.getAttribute("role");
  if (isTristate) {
    // Switch role cannot express mixed; checkbox can.
    if (role !== "checkbox") toggleBtn.setAttribute("role", "checkbox");
    ensureMixedIcon(toggleBtn);
  } else if (role !== "switch") {
    return null;
  }

  const initialOption =
    defaultState !== undefined
      ? defaultState
      : defaultChecked !== undefined
        ? defaultChecked
        : undefined;

  let state = resolveDefaultState(toggleEl, initialOption, isTristate);
  let isDisabled = resolveDisabled(toggleEl, disabled, toggleBtn);

  function syncDom({ emit = true, source = "init" } = {}) {
    toggleBtn.setAttribute("aria-checked", state);
    toggleEl.classList.toggle("is-on", state === "true");
    toggleEl.classList.toggle("is-mixed", state === "mixed");
    toggleBtn.disabled = isDisabled;
    toggleEl.classList.toggle("toggle--disabled", isDisabled);

    if (hiddenInput) {
      hiddenInput.value = state;
    }

    if (emit) {
      onChange?.({
        toggleEl,
        state,
        checked: state === "true",
        indeterminate: state === "mixed",
        source,
      });
    }
  }

  /**
   * @param {ToggleState | boolean | string} next
   * @param {{ emit?: boolean, source?: string }} [opts]
   */
  function setState(next, { emit = true, source = "api" } = {}) {
    const normalized = normalizeState(next, isTristate);
    if (normalized === state) {
      syncDom({ emit: false });
      return;
    }
    state = normalized;
    syncDom({ emit, source });
  }

  function setChecked(nextChecked, { emit = true, source = "api" } = {}) {
    setState(nextChecked ? "true" : "false", { emit, source });
  }

  function applyDisabled(nextDisabled) {
    isDisabled = Boolean(nextDisabled);
    syncDom({ emit: false });
  }

  toggleBtn.addEventListener("click", () => {
    if (isDisabled) return;
    if (isTristate) {
      setState(nextTriState(state), { source: "click" });
      return;
    }
    setChecked(state !== "true", { source: "click" });
  });

  syncDom({ emit: Boolean(onChange) });
  initIcons(toggleEl);

  return {
    getChecked() {
      return state === "true";
    },
    getState() {
      return state;
    },
    setChecked(checked) {
      setChecked(checked);
    },
    setState(next) {
      setState(next);
    },
    toggle() {
      if (isTristate) {
        setState(nextTriState(state), { source: "api" });
        return;
      }
      setChecked(state !== "true", { source: "api" });
    },
    cycle() {
      if (!isTristate) {
        setChecked(state !== "true", { source: "api" });
        return;
      }
      setState(nextTriState(state), { source: "api" });
    },
    isTristate() {
      return isTristate;
    },
    setDisabled(nextDisabled) {
      applyDisabled(nextDisabled);
    },
    isDisabled() {
      return isDisabled;
    },
  };
}

/** Wire every `.toggle` block in `root`. */
export function initToggles(root = document) {
  const instances = [];
  root.querySelectorAll(".toggle").forEach((toggleEl) => {
    const instance = initToggle(toggleEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
