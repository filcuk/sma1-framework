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
    onSelect: (detail) => onSelect?.({ dropdownEl, ...detail }),
  });
}
