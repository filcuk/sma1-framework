/**
 * Opt-in control attention glow (`.control-glow`).
 *
 * Prefer markup classes when the glow is static in HTML; use these helpers
 * to toggle at runtime.
 */

export const CONTROL_GLOW_CLASS = "control-glow";
export const CONTROL_GLOW_STATIC_CLASS = "control-glow--static";

/** @type {Record<"accent" | "danger" | "success", string>} */
const TONE_CLASSES = {
  accent: "control-glow--accent",
  danger: "control-glow--danger",
  success: "control-glow--success",
};

const ALL_TONE_CLASSES = Object.values(TONE_CLASSES);

/**
 * Apply (or update) a control glow on an element.
 * @param {HTMLElement | null | undefined} el
 * @param {{
 *   tone?: "accent" | "danger" | "success",
 *   color?: string,
 *   animated?: boolean,
 * }} [options]
 */
export function setControlGlow(el, { tone = "accent", color, animated = true } = {}) {
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
}

/**
 * Remove control glow classes and any custom colour override.
 * @param {HTMLElement | null | undefined} el
 */
export function clearControlGlow(el) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.remove(
    CONTROL_GLOW_CLASS,
    CONTROL_GLOW_STATIC_CLASS,
    ...ALL_TONE_CLASSES
  );
  el.style.removeProperty("--control-glow-color");
}
