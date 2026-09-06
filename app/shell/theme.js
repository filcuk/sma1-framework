import { APP_CONFIG } from "../config.js";
import { syncBrandIcons } from "../utils/brand-icon.js";
import { initSegmentedControl } from "../components/segmented-control.js";

const STORAGE_KEY = APP_CONFIG.themeStorageKey;
const THEME_CHANGE_EVENT = APP_CONFIG.themeChangeEvent;
const MODES = ["auto", "light", "dark"];

/** @type {ReturnType<typeof initSegmentedControl> | null} */
let themeToggle = null;

function getStoredPreference() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return MODES.includes(stored) ? stored : "auto";
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(preference = getStoredPreference()) {
  if (preference === "auto") return getSystemTheme();
  return preference;
}

function applyTheme(preference = getStoredPreference()) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  syncBrandIcons(resolved);
  document.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, {
      detail: { preference, resolved },
    })
  );
}

function setThemePreference(preference) {
  localStorage.setItem(STORAGE_KEY, preference);
  applyTheme(preference);
  syncThemeToggle(preference);
}

function syncThemeToggle(preference) {
  themeToggle?.selectValue(preference, { emit: false });
}

export function initThemeToggle(container) {
  if (!container) return;

  themeToggle = initSegmentedControl(container, {
    defaultValue: getStoredPreference(),
    onChange: ({ value, source }) => {
      if (source === "init") return;
      setThemePreference(value);
    },
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getStoredPreference() === "auto") {
        applyTheme("auto");
      }
    });
}

export function initTheme() {
  applyTheme(getStoredPreference());
}
