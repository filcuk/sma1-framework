/**
 * Tooltips: hover (default), timer (reaction flash), and persistent (tutorial).
 * See DESIGN.md — hover/timer share one slot; persistent tips are separate.
 *
 * Hover/focus tips skip disabled controls by default (`disabled`,
 * `aria-disabled="true"`, or a host class ending in `--disabled`). Opt in with
 * `data-tooltip-when-disabled`. Timer / persistent APIs are unaffected.
 *
 * Placement defaults to the content element. Set `data-tooltip-anchor` (CSS
 * selector) or pass `anchor` to `openTooltip()` / `updateTooltip()` to keep the
 * tip fixed on another control while the copy comes from the hovered source
 * (e.g. dropdown menu items previewing labels above an icon trigger).
 */

import { parseBooleanAttr } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";

const DEFAULT_OFFSET = 8;
const TOOLTIP_ID = "tooltip";
const TONE_CLASSES = ["tooltip--success", "tooltip--error"];

/** @typedef {"info" | "success" | "error"} TooltipTone */
/** @typedef {"hover" | "timer"} SharedSlotMode */
/** @typedef {{ maxWidth: string | null, nowrap: boolean, offset: number }} TipLayout */
/** @typedef {"top" | "bottom" | "left" | "right"} TooltipPosition */

/**
 * @typedef {{
 *   text?: string,
 *   tone?: TooltipTone,
 *   anchor?: HTMLElement | null,
 *   position?: TooltipPosition,
 *   maxWidth?: string | null,
 *   nowrap?: boolean,
 *   offset?: number,
 * }} TooltipShowOptions
 */

let tooltipEl = null;
/** Content source (reads `data-tooltip` / owns `aria-describedby`). */
/** @type {HTMLElement | null} */
let activeTarget = null;
/** Placement target (defaults to `activeTarget`). */
/** @type {HTMLElement | null} */
let activeAnchor = null;
/** @type {TooltipPosition | null} */
let activePosition = null;
/** Last tip copy shown in the shared slot (survives when not mirrored on `dataset`). */
/** @type {string | null} */
let activeText = null;
/** @type {SharedSlotMode | null} */
let slotMode = null;
/** @type {string | null} */
let savedDescribedBy = null;
/** @type {TipLayout | null} */
let activeLayout = null;

/**
 * @type {{
 *   target: HTMLElement,
 *   restoreText: string | null,
 *   restoreTone: string | null,
 *   timerId: ReturnType<typeof setTimeout>,
 * } | null}
 */
let timerState = null;

/**
 * @type {Map<string, {
 *   id: string,
 *   el: HTMLElement,
 *   target: HTMLElement,
 *   position: "top" | "bottom" | "left" | "right",
 *   layout: TipLayout,
 *   savedDescribedBy: string | null,
 * }>}
 */
const persistentById = new Map();

const boundRoots = new WeakSet();
let globalListenersBound = false;
let persistentSeq = 0;

/** @type {ReturnType<typeof setTimeout> | null} */
let hideCleanupTimer = null;
/** @type {((event: TransitionEvent) => void) | null} */
let hideTransitionHandler = null;

/** Fallback after hide transition (matches `--control-hover-ms`, plus slack). */
const HIDE_CLEANUP_MS = 120;

function ensureTooltipElement() {
  if (tooltipEl) return tooltipEl;

  tooltipEl = document.createElement("div");
  tooltipEl.id = TOOLTIP_ID;
  tooltipEl.className = "tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.hidden = true;
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

/**
 * @param {string | undefined} value
 * @returns {TooltipTone}
 */
function normalizeTone(value) {
  if (value === "success" || value === "error") return value;
  return "info";
}

/**
 * @param {HTMLElement} target
 * @returns {TooltipTone}
 */
function toneFromTarget(target) {
  return normalizeTone(target.dataset.tooltipTone);
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 * @param {TooltipTone} tone
 */
function fillTipContent(el, text, tone) {
  el.classList.remove(...TONE_CLASSES);
  if (tone === "success") el.classList.add("tooltip--success");
  if (tone === "error") el.classList.add("tooltip--error");

  el.replaceChildren();

  if (tone === "success" || tone === "error") {
    const iconWrap = document.createElement("span");
    iconWrap.className = "tooltip__icon";
    iconWrap.append(
      createIcon(tone === "success" ? "check" : "clear", {
        className: "tooltip__icon-svg",
      })
    );
    const label = document.createElement("span");
    label.className = "tooltip__label";
    label.textContent = text;
    el.append(iconWrap, label);
    return;
  }

  const label = document.createElement("span");
  label.className = "tooltip__label";
  label.textContent = text;
  el.append(label);
}

/**
 * @param {string | undefined} value
 * @returns {TooltipPosition}
 */
function normalizePosition(value) {
  if (value === "bottom" || value === "left" || value === "right") {
    return value;
  }
  return "top";
}

/**
 * @param {HTMLElement} target
 * @returns {TooltipPosition}
 */
function getPosition(target) {
  return normalizePosition(target.dataset.tooltipPosition);
}

/**
 * Resolve the placement element for a tooltip content source.
 * `data-tooltip-anchor` is a document CSS selector; invalid / missing → content.
 *
 * @param {HTMLElement} contentEl
 * @returns {HTMLElement}
 */
export function resolveTooltipAnchor(contentEl) {
  const sel = contentEl?.dataset?.tooltipAnchor?.trim?.();
  if (!sel) return contentEl;
  try {
    const root = typeof document !== "undefined" ? document : null;
    const found = root?.querySelector?.(sel);
    if (found) return /** @type {HTMLElement} */ (found);
  } catch {
    /* invalid selector */
  }
  return contentEl;
}

/**
 * Side preference: explicit override → content → anchor → top.
 *
 * @param {HTMLElement} contentEl
 * @param {HTMLElement} anchorEl
 * @param {TooltipPosition | undefined} override
 * @returns {TooltipPosition}
 */
function resolveTipPosition(contentEl, anchorEl, override) {
  if (override !== undefined) return normalizePosition(override);
  if (contentEl.dataset.tooltipPosition !== undefined) {
    return getPosition(contentEl);
  }
  if (anchorEl !== contentEl && anchorEl.dataset.tooltipPosition !== undefined) {
    return getPosition(anchorEl);
  }
  return "top";
}

/**
 * @typedef {{
 *   maxWidth?: string | null,
 *   nowrap?: boolean,
 *   offset?: number | string | null,
 * }} TooltipLayoutOptions
 */

/** Special `data-tooltip-max-width` / `maxWidth` value: tip width = trigger width. */
const MAX_WIDTH_MATCH = "match";

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeMaxWidth(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === MAX_WIDTH_MATCH) return MAX_WIDTH_MATCH;
  return trimmed;
}

/**
 * Gap in px between tip and trigger. Invalid values fall back to default.
 * @param {number | string | null | undefined} value
 * @returns {number}
 */
function normalizeOffset(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_OFFSET;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : DEFAULT_OFFSET;
}

/**
 * @param {HTMLElement} target
 * @param {TooltipLayoutOptions} [overrides]
 * @returns {TipLayout}
 */
function resolveTipLayout(target, overrides = {}) {
  const maxWidth =
    overrides.maxWidth !== undefined
      ? normalizeMaxWidth(overrides.maxWidth)
      : normalizeMaxWidth(target.dataset.tooltipMaxWidth);
  const nowrap =
    overrides.nowrap !== undefined
      ? Boolean(overrides.nowrap)
      : Boolean(parseBooleanAttr(target.dataset.tooltipNowrap));
  const offset =
    overrides.offset !== undefined
      ? normalizeOffset(overrides.offset)
      : normalizeOffset(target.dataset.tooltipOffset);
  return { maxWidth, nowrap, offset };
}

/**
 * @param {HTMLElement} el
 * @param {TipLayout} layout
 * @param {HTMLElement} [target]
 */
function applyTipLayout(el, layout, target) {
  el.classList.toggle("tooltip--nowrap", layout.nowrap);
  el.style.removeProperty("width");

  if (layout.maxWidth === MAX_WIDTH_MATCH && target) {
    const widthPx = `${Math.round(target.getBoundingClientRect().width)}px`;
    el.style.setProperty("--tooltip-max-width", widthPx);
    el.style.width = widthPx;
  } else if (layout.maxWidth) {
    el.style.setProperty("--tooltip-max-width", layout.maxWidth);
  } else if (layout.nowrap) {
    /* Single-line tips should grow with content unless a max-width is set. */
    el.style.setProperty("--tooltip-max-width", "none");
  } else {
    el.style.removeProperty("--tooltip-max-width");
  }
}

/**
 * @param {HTMLElement} el
 */
function clearTipLayout(el) {
  el.classList.remove("tooltip--nowrap");
  el.style.removeProperty("--tooltip-max-width");
  el.style.removeProperty("width");
}

/**
 * @param {HTMLElement} target
 * @returns {boolean}
 */
function isDisabledTooltipTarget(target) {
  if ("disabled" in target && Boolean(/** @type {{ disabled?: boolean }} */ (target).disabled)) {
    return true;
  }
  if (target.getAttribute("aria-disabled") === "true") return true;
  for (const name of target.classList) {
    if (name.endsWith("--disabled")) return true;
  }
  return false;
}

/**
 * Hover/focus tips are suppressed on disabled controls unless opted in.
 * @param {HTMLElement} target
 * @returns {boolean}
 */
function shouldSuppressHoverTooltip(target) {
  if (parseBooleanAttr(target.dataset.tooltipWhenDisabled)) return false;
  return isDisabledTooltipTarget(target);
}

/**
 * @param {HTMLElement} el
 * @param {HTMLElement} target
 * @param {"top" | "bottom" | "left" | "right"} position
 * @param {number} [offset]
 */
function placeTip(el, target, position, offset = DEFAULT_OFFSET) {
  if (el === tooltipEl) {
    cancelHideCleanup();
  }
  el.classList.add("is-visible");
  el.hidden = false;

  const rect = target.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  let top = 0;
  let left = 0;

  switch (position) {
    case "bottom":
      top = rect.bottom + offset;
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      break;
    case "left":
      top = rect.top + rect.height / 2 - tipRect.height / 2;
      left = rect.left - tipRect.width - offset;
      break;
    case "right":
      top = rect.top + rect.height / 2 - tipRect.height / 2;
      left = rect.right + offset;
      break;
    default:
      top = rect.top - tipRect.height - offset;
      left = rect.left + rect.width / 2 - tipRect.width / 2;
  }

  const maxLeft = window.innerWidth - tipRect.width - DEFAULT_OFFSET;
  const maxTop = window.innerHeight - tipRect.height - DEFAULT_OFFSET;
  left = Math.max(DEFAULT_OFFSET, Math.min(left, maxLeft));
  top = Math.max(DEFAULT_OFFSET, Math.min(top, maxTop));

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

/**
 * @param {HTMLElement} target
 * @param {string} tipDomId
 */
function linkDescribedBy(target, tipDomId) {
  savedDescribedBy = target.getAttribute("aria-describedby");
  const ids = new Set((savedDescribedBy || "").split(/\s+/).filter(Boolean));
  ids.add(tipDomId);
  target.setAttribute("aria-describedby", [...ids].join(" "));
}

/**
 * @param {HTMLElement} target
 */
function unlinkDescribedBy(target) {
  if (savedDescribedBy) {
    target.setAttribute("aria-describedby", savedDescribedBy);
  } else {
    target.removeAttribute("aria-describedby");
  }
  savedDescribedBy = null;
}

/** Restore idle tooltip text/tone after a cancelled or finished timer flash. */
function restoreTimerTarget() {
  if (!timerState) return;

  const { target, restoreText, restoreTone, timerId } = timerState;
  window.clearTimeout(timerId);
  timerState = null;

  if (restoreText !== null && restoreText !== undefined) {
    target.dataset.tooltip = restoreText;
  } else {
    delete target.dataset.tooltip;
  }

  if (restoreTone) {
    target.dataset.tooltipTone = restoreTone;
  } else {
    delete target.dataset.tooltipTone;
  }
}

function cancelHideCleanup() {
  if (hideCleanupTimer !== null) {
    window.clearTimeout(hideCleanupTimer);
    hideCleanupTimer = null;
  }
  if (hideTransitionHandler && tooltipEl) {
    tooltipEl.removeEventListener("transitionend", hideTransitionHandler);
  }
  hideTransitionHandler = null;
}

/** Finish hide after opacity fade — keep content until then so the box does not collapse. */
function finishHideSharedSlot() {
  cancelHideCleanup();
  if (!tooltipEl || tooltipEl.classList.contains("is-visible")) return;

  tooltipEl.classList.remove(...TONE_CLASSES);
  clearTipLayout(tooltipEl);
  tooltipEl.hidden = true;
  tooltipEl.replaceChildren();
}

function hideSharedSlot() {
  if (activeTarget) {
    unlinkDescribedBy(activeTarget);
    activeTarget = null;
  }
  activeAnchor = null;
  activePosition = null;
  activeText = null;
  slotMode = null;
  activeLayout = null;

  if (!tooltipEl) return;

  /* Already fully dismissed. */
  if (tooltipEl.hidden) {
    tooltipEl.classList.remove("is-visible", ...TONE_CLASSES);
    clearTipLayout(tooltipEl);
    tooltipEl.replaceChildren();
    return;
  }

  /* Fade already in progress — leave content until cleanup. */
  if (!tooltipEl.classList.contains("is-visible")) return;

  cancelHideCleanup();
  tooltipEl.classList.remove("is-visible");

  hideTransitionHandler = (event) => {
    if (event.target !== tooltipEl || event.propertyName !== "opacity") return;
    finishHideSharedSlot();
  };
  tooltipEl.addEventListener("transitionend", hideTransitionHandler);
  hideCleanupTimer = window.setTimeout(finishHideSharedSlot, HIDE_CLEANUP_MS);
}

/** Cancel hover/timer slot; restore timer trigger if a flash was in progress. */
function cancelSharedSlot() {
  if (timerState) {
    restoreTimerTarget();
  }
  hideSharedSlot();
}

/**
 * @param {HTMLElement} target Content source
 * @param {SharedSlotMode} mode
 * @param {TooltipShowOptions} [overrides]
 */
function showSharedSlot(target, mode, overrides = {}) {
  const text =
    overrides.text !== undefined ? overrides.text : target.dataset.tooltip;
  if (!text) return;

  const anchor =
    overrides.anchor instanceof HTMLElement
      ? overrides.anchor
      : resolveTooltipAnchor(target);
  const tone =
    overrides.tone !== undefined
      ? normalizeTone(overrides.tone)
      : toneFromTarget(target);
  const position = resolveTipPosition(target, anchor, overrides.position);
  const layoutOverrides = {
    maxWidth: overrides.maxWidth,
    nowrap: overrides.nowrap,
    offset: overrides.offset,
  };

  const sameAnchorUpdate =
    activeTarget &&
    activeTarget !== target &&
    activeAnchor === anchor &&
    slotMode === mode;

  if (activeTarget && activeTarget !== target && !sameAnchorUpdate) {
    hideSharedSlot();
  } else if (activeTarget === target && slotMode === "timer" && mode === "hover") {
    /* Keep timer tip when re-entering the same control. */
    return;
  }

  const el = ensureTooltipElement();
  fillTipContent(el, text, tone);
  activeLayout = resolveTipLayout(target, layoutOverrides);
  applyTipLayout(el, activeLayout, anchor);

  if (activeTarget !== target) {
    if (activeTarget) unlinkDescribedBy(activeTarget);
    activeTarget = target;
    linkDescribedBy(target, TOOLTIP_ID);
  }
  activeAnchor = anchor;
  activePosition = position;
  activeText = text;
  slotMode = mode;
  placeTip(el, anchor, position, activeLayout.offset);
}

/**
 * @param {HTMLElement} target
 * @param {TooltipShowOptions} [overrides]
 */
function showHover(target, overrides = {}) {
  if (shouldSuppressHoverTooltip(target)) {
    if (slotMode === "hover" && activeTarget === target) {
      hideSharedSlot();
    }
    return;
  }

  if (timerState && timerState.target !== target) {
    restoreTimerTarget();
    hideSharedSlot();
  } else if (timerState && timerState.target === target) {
    return;
  } else if (slotMode && slotMode !== "hover") {
    hideSharedSlot();
  }

  showSharedSlot(target, "hover", overrides);
}

function handlePointerOver(e) {
  const target = e.target.closest("[data-tooltip]");
  if (!target || !e.currentTarget.contains(target)) return;
  showHover(target);
}

function handlePointerOut(e) {
  if (slotMode !== "hover") return;

  const from = e.target.closest("[data-tooltip]");
  if (!from) return;

  const to = e.relatedTarget?.closest?.("[data-tooltip]");
  if (to === from) return;

  /* Moving between sources that share a placement anchor — keep tip, let over update. */
  if (to && activeAnchor && resolveTooltipAnchor(to) === activeAnchor) {
    return;
  }

  if (activeTarget === from) {
    hideSharedSlot();
  }
}

function handleFocusIn(e) {
  const target = e.target.closest?.("[data-tooltip]");
  if (!target || !e.currentTarget.contains(target)) return;
  showHover(target);
}

function handleFocusOut(e) {
  if (slotMode !== "hover") return;

  const from = e.target.closest?.("[data-tooltip]");
  if (!from) return;

  const to = e.relatedTarget?.closest?.("[data-tooltip]");
  if (to === from) return;

  if (to && activeAnchor && resolveTooltipAnchor(to) === activeAnchor) {
    return;
  }

  if (activeTarget === from) {
    hideSharedSlot();
  }
}

function repositionShared() {
  if (!activeTarget || !tooltipEl) return;
  if (!activeTarget.isConnected) {
    cancelSharedSlot();
    return;
  }
  const anchor = activeAnchor?.isConnected ? activeAnchor : activeTarget;
  if (slotMode === "hover" && shouldSuppressHoverTooltip(activeTarget)) {
    hideSharedSlot();
    return;
  }
  const text =
    activeTarget.dataset.tooltip !== undefined && activeTarget.dataset.tooltip !== ""
      ? activeTarget.dataset.tooltip
      : activeText;
  if (!text) {
    cancelSharedSlot();
    return;
  }
  fillTipContent(tooltipEl, text, toneFromTarget(activeTarget));
  activeText = text;
  if (slotMode === "hover" || !activeLayout) {
    activeLayout = resolveTipLayout(activeTarget);
  }
  applyTipLayout(tooltipEl, activeLayout, anchor);
  const position =
    activePosition || resolveTipPosition(activeTarget, anchor, undefined);
  placeTip(tooltipEl, anchor, position, activeLayout.offset);
}

function repositionPersistent() {
  for (const entry of persistentById.values()) {
    if (!entry.target.isConnected) {
      dismissPersistentTooltip(entry.id);
      continue;
    }
    applyTipLayout(entry.el, entry.layout, entry.target);
    placeTip(entry.el, entry.target, entry.position, entry.layout.offset);
  }
}

function repositionAll() {
  repositionShared();
  repositionPersistent();
}

/**
 * Show the shared-slot tip in hover mode.
 *
 * Without options, reads `data-tooltip` on `target` and places on
 * `resolveTooltipAnchor(target)` (or `target` itself).
 *
 * Pass `text` and/or `anchor` to drive copy and placement independently — e.g.
 * keep the tip above a dropdown trigger while menu items supply the label.
 *
 * @param {HTMLElement} target Content source (and default anchor)
 * @param {TooltipShowOptions} [options]
 */
export function openTooltip(target, options = {}) {
  showHover(target, options);
}

/**
 * Update the active shared-slot tip’s copy (and optional tone / layout) without
 * changing the placement anchor. No-op when no tip is showing.
 *
 * @param {{
 *   text: string,
 *   tone?: TooltipTone,
 *   maxWidth?: string | null,
 *   nowrap?: boolean,
 *   offset?: number,
 * }} options
 * @returns {boolean} Whether an active tip was updated
 */
export function updateTooltip(options) {
  if (!activeTarget || !tooltipEl || !options?.text) return false;
  const anchor = activeAnchor?.isConnected ? activeAnchor : activeTarget;
  const tone =
    options.tone !== undefined
      ? normalizeTone(options.tone)
      : toneFromTarget(activeTarget);
  fillTipContent(tooltipEl, options.text, tone);
  activeText = options.text;
  if (
    options.maxWidth !== undefined ||
    options.nowrap !== undefined ||
    options.offset !== undefined
  ) {
    activeLayout = resolveTipLayout(activeTarget, {
      maxWidth: options.maxWidth,
      nowrap: options.nowrap,
      offset: options.offset,
    });
  } else if (!activeLayout) {
    activeLayout = resolveTipLayout(activeTarget);
  }
  applyTipLayout(tooltipEl, activeLayout, anchor);
  const position =
    activePosition || resolveTipPosition(activeTarget, anchor, undefined);
  placeTip(tooltipEl, anchor, position, activeLayout.offset);
  return true;
}

/** Hide the shared hover/timer tooltip, restoring any in-flight timer flash. */
export function closeTooltip() {
  cancelSharedSlot();
}

/**
 * Timer-mode reaction tip. Stays visible without hover until `durationMs` or
 * another hover/timer tip takes the shared slot.
 *
 * @param {HTMLElement} target
 * @param {{
 *   text: string,
 *   tone?: TooltipTone,
 *   restoreText?: string | null,
 *   restoreTone?: string | null,
 *   durationMs?: number,
 *   maxWidth?: string | null,
 *   nowrap?: boolean,
 *   offset?: number,
 * }} options
 */
export function flashTooltip(target, options) {
  const {
    text,
    tone = "info",
    restoreText,
    restoreTone,
    durationMs = 2000,
    maxWidth,
    nowrap,
    offset,
  } = options;

  const prevText = Object.hasOwn(target.dataset, "tooltip")
    ? target.dataset.tooltip
    : null;
  const prevTone = Object.hasOwn(target.dataset, "tooltipTone")
    ? target.dataset.tooltipTone
    : null;

  cancelSharedSlot();

  target.dataset.tooltip = text;
  if (tone === "success" || tone === "error") {
    target.dataset.tooltipTone = tone;
  } else {
    delete target.dataset.tooltipTone;
  }

  if (typeof target.blur === "function") {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    target.blur();
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
      window.scrollTo(scrollX, scrollY);
    }
  }

  showSharedSlot(target, "timer", { maxWidth, nowrap, offset });

  timerState = {
    target,
    restoreText: restoreText !== undefined ? restoreText : prevText,
    restoreTone: restoreTone !== undefined ? restoreTone : prevTone,
    timerId: window.setTimeout(() => {
      const state = timerState;
      if (!state || state.target !== target) return;
      restoreTimerTarget();
      if (slotMode === "timer" && activeTarget === target) {
        hideSharedSlot();
      }
    }, durationMs),
  };
}

/**
 * Persistent tip (tutorial). Independent of the hover/timer slot.
 * Optional `position` overrides `data-tooltip-position` on the target so a
 * hover tip on the same control can sit on a different side.
 *
 * @param {HTMLElement} target
 * @param {{
 *   text: string,
 *   tone?: TooltipTone,
 *   id?: string,
 *   position?: "top" | "bottom" | "left" | "right",
 *   maxWidth?: string | null,
 *   nowrap?: boolean,
 *   offset?: number,
 * }} options
 * @returns {string} Tip id for `dismissPersistentTooltip`
 */
export function showPersistentTooltip(target, options) {
  const {
    text,
    tone = "info",
    id,
    position: positionOpt,
    maxWidth,
    nowrap,
    offset,
  } = options;
  const tipId = id || `tooltip-persistent-${++persistentSeq}`;
  const position =
    positionOpt !== undefined
      ? normalizePosition(positionOpt)
      : getPosition(target);
  const layout = resolveTipLayout(target, { maxWidth, nowrap, offset });

  dismissPersistentTooltip(tipId);

  const el = document.createElement("div");
  el.id = tipId;
  el.className = "tooltip tooltip--persistent";
  el.setAttribute("role", "tooltip");
  fillTipContent(el, text, normalizeTone(tone));
  applyTipLayout(el, layout, target);
  document.body.append(el);

  const prevDescribedBy = target.getAttribute("aria-describedby");
  const ids = new Set((prevDescribedBy || "").split(/\s+/).filter(Boolean));
  ids.add(tipId);
  target.setAttribute("aria-describedby", [...ids].join(" "));

  placeTip(el, target, position, layout.offset);

  persistentById.set(tipId, {
    id: tipId,
    el,
    target,
    position,
    layout,
    savedDescribedBy: prevDescribedBy,
  });

  return tipId;
}

/**
 * Dismiss a persistent tip by id, or all tips anchored to a given element.
 *
 * @param {string | HTMLElement} idOrTarget
 */
export function dismissPersistentTooltip(idOrTarget) {
  if (typeof idOrTarget === "string") {
    const entry = persistentById.get(idOrTarget);
    if (!entry) return;
    persistentById.delete(idOrTarget);
    if (entry.savedDescribedBy) {
      entry.target.setAttribute("aria-describedby", entry.savedDescribedBy);
    } else {
      entry.target.removeAttribute("aria-describedby");
    }
    entry.el.remove();
    return;
  }

  for (const [id, entry] of [...persistentById.entries()]) {
    if (entry.target === idOrTarget) {
      dismissPersistentTooltip(id);
    }
  }
}

export function initTooltips(root = document) {
  if (boundRoots.has(root)) return;

  ensureTooltipElement();

  root.addEventListener("mouseover", handlePointerOver);
  root.addEventListener("mouseout", handlePointerOut);
  root.addEventListener("focusin", handleFocusIn);
  root.addEventListener("focusout", handleFocusOut);

  if (!globalListenersBound) {
    window.addEventListener("scroll", repositionAll, true);
    window.addEventListener("resize", repositionAll);
    globalListenersBound = true;
  }

  boundRoots.add(root);
}
