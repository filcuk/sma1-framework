import { setHidden } from "./dom.js";
import {
  onDocumentClickOutside,
  onDocumentEscape,
  registerOpenPopup,
  unregisterOpenPopup,
} from "./document-listeners.js";

const DEFAULT_DROPDOWN_GRID_MIN = 6;
const DEFAULT_DROPDOWN_GRID_COLS = 2;

/** Default item-count threshold before a dropdown menu switches to grid layout. */
export const DROPDOWN_GRID_DEFAULT_MIN = DEFAULT_DROPDOWN_GRID_MIN;

/** Default column count for dropdown menu grid layout. */
export const DROPDOWN_GRID_DEFAULT_COLS = DEFAULT_DROPDOWN_GRID_COLS;

function readDropdownGridCols(containerEl) {
  const colsRaw = containerEl?.dataset.dropdownGridCols;
  const cols =
    colsRaw !== undefined
      ? Number.parseInt(colsRaw, 10)
      : DEFAULT_DROPDOWN_GRID_COLS;
  return Number.isFinite(cols) && cols >= 1 ? cols : DEFAULT_DROPDOWN_GRID_COLS;
}

/** Disabled grid config returned when auto grid is off. */
export function disabledDropdownGridConfig() {
  return {
    enabled: false,
    min: DEFAULT_DROPDOWN_GRID_MIN,
    cols: DEFAULT_DROPDOWN_GRID_COLS,
  };
}

/**
 * Read auto-grid settings from a `.dropdown` host (`data-dropdown-grid*`).
 *
 * - `data-dropdown-grid="8"` — enable; switch when item count exceeds `8`
 * - `data-dropdown-grid` / `data-dropdown-grid="true"` — enable with default threshold ({@link DROPDOWN_GRID_DEFAULT_MIN})
 * - `data-dropdown-grid="false"` — force list layout
 * - `data-dropdown-grid-min="8"` — same as numeric `data-dropdown-grid` (explicit name)
 * - `data-dropdown-grid-cols="2"` — column count in grid mode
 */
export function readDropdownGridConfig(containerEl) {
  if (!containerEl) return disabledDropdownGridConfig();

  const gridAttr = containerEl.dataset.dropdownGrid;
  if (gridAttr !== undefined) {
    if (gridAttr === "false") return disabledDropdownGridConfig();
    if (gridAttr === "" || gridAttr === "true") {
      return {
        enabled: true,
        min: DEFAULT_DROPDOWN_GRID_MIN,
        cols: readDropdownGridCols(containerEl),
      };
    }
    const parsedMin = Number.parseInt(gridAttr, 10);
    if (Number.isFinite(parsedMin) && parsedMin >= 0) {
      return {
        enabled: true,
        min: parsedMin,
        cols: readDropdownGridCols(containerEl),
      };
    }
  }

  const minAttr = containerEl.dataset.dropdownGridMin;
  if (minAttr !== undefined) {
    const min = Number.parseInt(minAttr, 10);
    return {
      enabled: true,
      min: Number.isFinite(min) && min >= 0 ? min : DEFAULT_DROPDOWN_GRID_MIN,
      cols: readDropdownGridCols(containerEl),
    };
  }

  return disabledDropdownGridConfig();
}

/**
 * Merge markup `data-dropdown-grid*` with init / runtime options.
 *
 * @param {HTMLElement | null | undefined} containerEl
 * @param {{ gridMin?: number | false; gridCols?: number }} [options]
 */
export function resolveDropdownGridConfig(containerEl, { gridMin, gridCols } = {}) {
  if (gridMin === false) return disabledDropdownGridConfig();

  let config = readDropdownGridConfig(containerEl);

  if (typeof gridMin === "number" && Number.isFinite(gridMin) && gridMin >= 0) {
    config = {
      ...config,
      enabled: true,
      min: gridMin,
    };
  }

  if (typeof gridCols === "number" && Number.isFinite(gridCols) && gridCols >= 1) {
    config = { ...config, cols: gridCols };
  }

  return config;
}

function countSelectableMenuItems(menuEl, itemSelector) {
  return [...menuEl.querySelectorAll(itemSelector)].filter(
    (item) => !item.disabled
  ).length;
}

/**
 * Toggle `.dropdown-menu--grid` when a dropdown has more than `min` items.
 * Group headers and separators span the full menu width in grid mode.
 *
 * @param {ReturnType<typeof resolveDropdownGridConfig>} [config]
 */
export function syncDropdownMenuGrid(menuEl, containerEl, itemSelector, config) {
  if (!menuEl?.classList.contains("dropdown-menu")) return false;

  const resolved =
    config ?? resolveDropdownGridConfig(containerEl, {});
  const itemCount = countSelectableMenuItems(menuEl, itemSelector);
  const useGrid = resolved.enabled && itemCount > resolved.min;

  menuEl.classList.toggle("dropdown-menu--grid", useGrid);
  if (useGrid) {
    menuEl.style.setProperty("--dropdown-menu-grid-cols", String(resolved.cols));
  } else {
    menuEl.style.removeProperty("--dropdown-menu-grid-cols");
  }

  return useGrid;
}

function getDropdownGridColumns(menuEl) {
  const raw =
    menuEl.style.getPropertyValue("--dropdown-menu-grid-cols") ||
    getComputedStyle(menuEl).getPropertyValue("--dropdown-menu-grid-cols");
  const cols = Number.parseInt(raw, 10);
  return Number.isFinite(cols) && cols >= 1 ? cols : DEFAULT_DROPDOWN_GRID_COLS;
}

export function gridMenuIndexForKey(items, currentIndex, key, cols) {
  const len = items.length;
  if (currentIndex < 0) return 0;

  const col = currentIndex % cols;
  const row = Math.floor(currentIndex / cols);
  const rowCount = Math.ceil(len / cols);

  switch (key) {
    case "ArrowRight":
      return currentIndex < len - 1 ? currentIndex + 1 : currentIndex;
    case "ArrowLeft":
      return currentIndex > 0 ? currentIndex - 1 : currentIndex;
    case "ArrowDown": {
      const nextRow = row + 1;
      if (nextRow >= rowCount) return currentIndex;
      const next = nextRow * cols + col;
      return next < len ? next : currentIndex;
    }
    case "ArrowUp": {
      const prevRow = row - 1;
      if (prevRow < 0) return currentIndex;
      return prevRow * cols + col;
    }
    default:
      return currentIndex;
  }
}

/** Primary label for a menu item (ignores `.dropdown-menu-item-subtitle`). */
export function menuItemLabel(item) {
  if (!item) return "";
  return (
    item.querySelector(".dropdown-menu-item-label")?.textContent.trim() ??
    item.textContent.trim()
  );
}

/**
 * Shared open/close behaviour for anchored popup menus (combo chevron, dropdown).
 *
 * Only one popup menu is open at a time: opening one closes any other.
 *
 * @param {object} options
 * @param {boolean} [options.fixed=false] Position with `position: fixed` so the
 *   menu escapes overflow clipping (e.g. inside `.table-wrap`).
 * @param {"start" | "end"} [options.fixedAlign="start"] Horizontal align to the
 *   toggle when `fixed` is true (`end` = right edges line up).
 * @param {number | false} [options.gridMin] Item-count threshold before grid
 *   layout; a number enables auto grid and overrides `data-dropdown-grid*`.
 *   Pass `false` to force a single-column list.
 * @param {number} [options.gridCols] Column count in grid mode (overrides markup).
 */
export function initPopupMenu({
  containerEl,
  menuEl,
  toggleEl,
  itemSelector,
  onSelect,
  closeOnSelect = true,
  fixed = false,
  fixedAlign = "start",
  gridMin,
  gridCols,
}) {
  if (!containerEl || !menuEl) return null;

  let isOpen = false;
  const gridOverrides = {};
  if (gridMin !== undefined) gridOverrides.gridMin = gridMin;
  if (gridCols !== undefined) gridOverrides.gridCols = gridCols;

  function getGridConfig() {
    return resolveDropdownGridConfig(containerEl, gridOverrides);
  }

  function getItems() {
    return [...menuEl.querySelectorAll(itemSelector)].filter((item) => {
      if (item.disabled) return false;
      // `position: fixed` items have a null offsetParent — use layout boxes instead.
      if (item.offsetParent !== null) return true;
      return item.getClientRects().length > 0;
    });
  }

  function focusItem(item) {
    if (item instanceof HTMLElement) item.focus();
  }

  function focusFirstItem() {
    const items = getItems();
    if (items.length) focusItem(items[0]);
  }

  function setContainerOpen(open) {
    containerEl?.classList.toggle("is-popup-open", open);
  }

  function clearFixedPosition() {
    if (!fixed) return;
    menuEl.style.position = "";
    menuEl.style.top = "";
    menuEl.style.left = "";
    menuEl.style.right = "";
    menuEl.style.bottom = "";
    menuEl.style.zIndex = "";
    menuEl.style.width = "";
    menuEl.style.minWidth = "";
    menuEl.style.maxHeight = "";
    menuEl.style.overflowY = "";
  }

  function positionFixedMenu() {
    if (!fixed || !toggleEl) return;
    const rect = toggleEl.getBoundingClientRect();
    const gap = 4;
    const viewportPadding = 8;
    const viewportWidth = document.documentElement.clientWidth;

    menuEl.style.position = "fixed";
    menuEl.style.zIndex = "200";
    menuEl.style.bottom = "auto";
    menuEl.style.width = "max-content";
    // Percentage min-width is viewport-relative when position is fixed.
    menuEl.style.minWidth = `${rect.width}px`;
    menuEl.style.maxHeight = "";
    menuEl.style.overflowY = "";
    menuEl.style.top = `${rect.bottom + gap}px`;

    if (fixedAlign === "end") {
      menuEl.style.left = "auto";
      menuEl.style.right = `${viewportWidth - rect.right}px`;
    } else {
      menuEl.style.right = "auto";
      menuEl.style.left = `${rect.left}px`;
    }

    const menuRect = menuEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    if (menuRect.height > spaceBelow && spaceAbove > spaceBelow) {
      menuEl.style.top = `${Math.max(viewportPadding, rect.top - menuRect.height - gap)}px`;
    }

    const top = Number.parseFloat(menuEl.style.top) || viewportPadding;
    const maxHeight = window.innerHeight - top - viewportPadding;
    if (menuEl.getBoundingClientRect().height > maxHeight) {
      menuEl.style.maxHeight = `${Math.max(8 * 16, maxHeight)}px`;
      menuEl.style.overflowY = "auto";
    }

    const placed = menuEl.getBoundingClientRect();
    if (placed.left < viewportPadding) {
      menuEl.style.right = "auto";
      menuEl.style.left = `${viewportPadding}px`;
    } else if (placed.right > viewportWidth - viewportPadding) {
      menuEl.style.left = "auto";
      menuEl.style.right = `${viewportPadding}px`;
    }
  }

  /**
   * @param {{ restoreFocus?: boolean }} [options]
   */
  function closeMenu({ restoreFocus = true } = {}) {
    if (!isOpen) return;
    isOpen = false;
    unregisterOpenPopup(closeMenu);
    setContainerOpen(false);
    setHidden(menuEl, true);
    clearFixedPosition();
    toggleEl?.setAttribute("aria-expanded", "false");
    if (restoreFocus && toggleEl?.isConnected) {
      toggleEl.focus();
    }
  }

  function syncMenuGrid() {
    return syncDropdownMenuGrid(menuEl, containerEl, itemSelector, getGridConfig());
  }

  syncMenuGrid();

  function openMenu() {
    isOpen = true;
    registerOpenPopup(closeMenu);
    setContainerOpen(true);
    setHidden(menuEl, false);
    syncMenuGrid();
    toggleEl?.setAttribute("aria-expanded", "true");
    positionFixedMenu();
    focusFirstItem();
  }

  function toggleMenu() {
    if (isOpen) closeMenu();
    else openMenu();
  }

  function activateItem(item) {
    // Close the panel before onSelect so handlers can tear down the DOM, but
    // defer focus restore until afterward — focusing a trigger that is about
    // to be destroyed (e.g. remove column) would flash its tooltip.
    if (closeOnSelect) {
      closeMenu({ restoreFocus: false });
    }
    onSelect?.({
      containerEl,
      item,
      value: item.dataset.value,
      label: menuItemLabel(item),
    });
    if (closeOnSelect && toggleEl?.isConnected) {
      toggleEl.focus();
    }
  }

  function onToggleClick(e) {
    e.stopPropagation();
    toggleMenu();
  }

  function onMenuClick(e) {
    const item = e.target.closest(itemSelector);
    if (!item) return;

    if (item instanceof HTMLAnchorElement) {
      // Modified clicks: let the browser open a new tab; only close the menu.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        if (closeOnSelect) {
          closeMenu({ restoreFocus: false });
        }
        return;
      }
      // Plain primary click: onSelect handles navigation (e.g. same window).
      e.preventDefault();
    }

    activateItem(item);
  }

  function onMenuKeydown(e) {
    if (!isOpen) return;

    const items = getItems();
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = currentIndex;

    const gridMode = menuEl.classList.contains("dropdown-menu--grid");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (gridMode) {
        nextIndex =
          currentIndex < 0
            ? 0
            : gridMenuIndexForKey(
                items,
                currentIndex,
                "ArrowDown",
                getDropdownGridColumns(menuEl)
              );
      } else {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      }
      focusItem(items[nextIndex]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (gridMode) {
        nextIndex =
          currentIndex < 0
            ? items.length - 1
            : gridMenuIndexForKey(
                items,
                currentIndex,
                "ArrowUp",
                getDropdownGridColumns(menuEl)
              );
      } else {
        nextIndex =
          currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      }
      focusItem(items[nextIndex]);
    } else if (
      gridMode &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault();
      nextIndex =
        currentIndex < 0
          ? 0
          : gridMenuIndexForKey(
              items,
              currentIndex,
              e.key,
              getDropdownGridColumns(menuEl)
            );
      focusItem(items[nextIndex]);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(items[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(items[items.length - 1]);
    } else if (e.key === "Enter" || e.key === " ") {
      const item = document.activeElement?.closest?.(itemSelector);
      if (!item || !menuEl.contains(item)) return;
      e.preventDefault();
      activateItem(item);
    }
  }

  function onViewportChange() {
    if (isOpen) closeMenu();
  }

  toggleEl?.addEventListener("click", onToggleClick);
  menuEl.addEventListener("click", onMenuClick);
  menuEl.addEventListener("keydown", onMenuKeydown);

  if (fixed) {
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
  }

  const removeClickOutside = onDocumentClickOutside((e) => {
    if (!containerEl.contains(e.target)) closeMenu();
  });

  const removeEscape = onDocumentEscape(() => {
    if (!isOpen) return false;
    closeMenu();
    return true;
  }, { priority: 50 });

  return {
    closeMenu,
    openMenu,
    toggleMenu,
    isOpen: () => isOpen,
    syncMenuGrid,
    getGridConfig,
    /** @param {number | false} min */
    setGridMin(min) {
      gridOverrides.gridMin = min;
      return syncMenuGrid();
    },
    /** @param {number} cols */
    setGridCols(cols) {
      gridOverrides.gridCols = cols;
      return syncMenuGrid();
    },
    destroy() {
      unregisterOpenPopup(closeMenu);
      setContainerOpen(false);
      toggleEl?.removeEventListener("click", onToggleClick);
      menuEl.removeEventListener("click", onMenuClick);
      menuEl.removeEventListener("keydown", onMenuKeydown);
      if (fixed) {
        window.removeEventListener("scroll", onViewportChange, true);
        window.removeEventListener("resize", onViewportChange);
      }
      clearFixedPosition();
      removeClickOutside();
      removeEscape();
    },
  };
}
