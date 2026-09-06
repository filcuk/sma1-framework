import { initPopupMenu, resolvePopupFixedOptions } from "../utils/menu.js";

/**
 * @param {HTMLElement | null} dropdownEl
 * @param {{
 *   onSelect?: (detail: object) => void;
 *   gridMin?: number | false;
 *   gridCols?: number;
 *   fixed?: boolean;
 *   fixedAlign?: "start" | "end";
 * }} [options]
 */
export function initDropdown(
  dropdownEl,
  { onSelect, gridMin, gridCols, fixed, fixedAlign } = {},
) {
  if (!dropdownEl) return null;

  const trigger = dropdownEl.querySelector(".dropdown-trigger");
  const menu = dropdownEl.querySelector(".dropdown-menu");
  const popupFixed = resolvePopupFixedOptions(dropdownEl, { fixed, fixedAlign });

  return initPopupMenu({
    containerEl: dropdownEl,
    menuEl: menu,
    toggleEl: trigger,
    itemSelector: ".dropdown-menu-item",
    gridMin,
    gridCols,
    fixed: popupFixed.fixed,
    fixedAlign: popupFixed.fixedAlign,
    onSelect: (detail) => onSelect?.({ dropdownEl, ...detail }),
  });
}
