/**
 * Opt-in control attention glow (`.control-glow`).
 *
 * Prefer markup classes when the glow is static in HTML; use these helpers
 * to toggle at runtime.
 */

import { getIconCssMaskImage } from "./icons.js";

export const CONTROL_GLOW_CLASS = "control-glow";
export const CONTROL_GLOW_STATIC_CLASS = "control-glow--static";
export const CONTROL_GLOW_MASKED_CLASS = "control-glow--masked";

/** @type {Record<"accent" | "danger" | "success", string>} */
const TONE_CLASSES = {
  accent: "control-glow--accent",
  danger: "control-glow--danger",
  success: "control-glow--success",
};

const ALL_TONE_CLASSES = Object.values(TONE_CLASSES);

/**
 * Mask shine (and use glyph drop-shadow halo) to an icon shape.
 * @param {HTMLElement} el
 * @param {string | null | undefined} iconName
 *   Catalogue icon id, or null/empty to clear the mask.
 */
export function setControlGlowMask(el, iconName) {
  if (!(el instanceof HTMLElement)) return;

  if (typeof iconName === "string" && iconName.trim()) {
    el.style.setProperty("--control-glow-mask", getIconCssMaskImage(iconName.trim()));
    el.classList.add(CONTROL_GLOW_MASKED_CLASS);
    return;
  }

  el.style.removeProperty("--control-glow-mask");
  el.classList.remove(CONTROL_GLOW_MASKED_CLASS);
}

/**
 * Apply (or update) a control glow on an element.
 * @param {HTMLElement | null | undefined} el
 * @param {{
 *   tone?: "accent" | "danger" | "success",
 *   color?: string,
 *   animated?: boolean,
 *   maskIcon?: string | null,
 * }} [options]
 */
export function setControlGlow(
  el,
  { tone = "accent", color, animated = true, maskIcon } = {}
) {
  if (!(el instanceof HTMLElement)) return;

  el.classList.add(CONTROL_GLOW_CLASS);
  for (const cls of ALL_TONE_CLASSES) el.classList.remove(cls);
  el.classList.add(TONE_CLASSES[tone] ?? TONE_CLASSES.accent);
  el.classList.toggle(CONTROL_GLOW_STATIC_CLASS, animated === false);

  if (typeof color === "string" && color.trim()) {
    el.style.setProperty("--control-glow-color", color.trim());
  } else {
    el.style.removeProperty("--control-glow-color");
  }

  if (maskIcon !== undefined) {
    setControlGlowMask(el, maskIcon);
  }
}

/**
 * Remove control glow classes and any custom colour / mask override.
 * @param {HTMLElement | null | undefined} el
 */
export function clearControlGlow(el) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.remove(
    CONTROL_GLOW_CLASS,
    CONTROL_GLOW_STATIC_CLASS,
    CONTROL_GLOW_MASKED_CLASS,
    ...ALL_TONE_CLASSES
  );
  el.style.removeProperty("--control-glow-color");
  el.style.removeProperty("--control-glow-mask");
}
