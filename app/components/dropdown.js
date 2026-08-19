import { initPopupMenu } from "../utils/menu.js";

export function initDropdown(dropdownEl, { onSelect } = {}) {
  if (!dropdownEl) return null;

  const trigger = dropdownEl.querySelector(".dropdown-trigger");
  const menu = dropdownEl.querySelector(".dropdown-menu");

  return initPopupMenu({
    containerEl: dropdownEl,
    menuEl: menu,
    toggleEl: trigger,
    itemSelector: ".dropdown-menu-item",
    // Fixed so menu escapes stacking/overflow clipping (e.g. above code-block
    // gutter chrome).
    fixed: true,
    onSelect: (detail) => onSelect?.({ dropdownEl, ...detail }),
  });
}
