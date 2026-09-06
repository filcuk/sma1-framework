/**
 * Footer shield control: privacy tooltip + menu to clear / disable app storage.
 * Theme preference is never cleared or disabled here.
 */

import { flashTooltip } from "../components/tooltip.js";
import {
  clearAppStorage,
  isAppStorageEnabled,
  isAppStorageInitialized,
  setAppStorageEnabled,
} from "../utils/app-storage.js";
import { initPopupMenu } from "../utils/menu.js";

/**
 * Sync enable/disable label and disabled state for menu actions.
 *
 * @param {ParentNode} containerEl
 */
function syncStorageMenu(containerEl) {
  const ready = isAppStorageInitialized();
  const enabled = isAppStorageEnabled();
  const toggleLabel = containerEl.querySelector("[data-storage-toggle-label]");
  if (toggleLabel) {
    toggleLabel.textContent = enabled
      ? "Disable local storage"
      : "Enable local storage";
  }

  containerEl
    .querySelectorAll("[data-storage-action]")
    .forEach((item) => {
      if (!(item instanceof HTMLButtonElement)) return;
      item.disabled = !ready;
    });
}

/**
 * Wire the footer local-storage shield dropdown.
 *
 * @param {ParentNode} [root=document]
 * @returns {ReturnType<typeof initPopupMenu> | null}
 */
export function initAppStorageUi(root = document) {
  const containerEl =
    root.querySelector?.("#footer-storage") ??
    document.getElementById("footer-storage");
  if (!containerEl) return null;

  const trigger = containerEl.querySelector(".footer-storage-trigger");
  const menuEl = containerEl.querySelector(".footer-storage-menu");
  if (!(trigger instanceof HTMLElement) || !menuEl) return null;

  syncStorageMenu(containerEl);

  const onTogglePointer = () => {
    syncStorageMenu(containerEl);
  };
  trigger.addEventListener("pointerdown", onTogglePointer);
  trigger.addEventListener("keydown", onTogglePointer);

  const menuApi = initPopupMenu({
    containerEl,
    menuEl,
    toggleEl: trigger,
    itemSelector: ".dropdown-menu-item",
    fixed: true,
    fixedAlign: "start",
    onSelect: ({ item }) => {
      if (!(item instanceof HTMLElement)) return;
      const action = item.dataset.storageAction;
      if (action === "clear") {
        const ok = clearAppStorage();
        flashTooltip(trigger, {
          text: ok ? "Stored data cleared" : "Nothing to clear",
          tone: ok ? "success" : "info",
          maxWidth: "16rem",
        });
        syncStorageMenu(containerEl);
        return;
      }
      if (action === "toggle") {
        const next = !isAppStorageEnabled();
        const ok = setAppStorageEnabled(next);
        flashTooltip(trigger, {
          text: ok
            ? next
              ? "Local storage enabled"
              : "Local storage disabled"
            : "Storage unavailable",
          tone: ok ? "success" : "error",
          maxWidth: "16rem",
        });
        syncStorageMenu(containerEl);
      }
    },
  });

  if (!menuApi) return null;

  const originalDestroy = menuApi.destroy;
  return {
    ...menuApi,
    destroy() {
      trigger.removeEventListener("pointerdown", onTogglePointer);
      trigger.removeEventListener("keydown", onTogglePointer);
      originalDestroy?.();
    },
  };
}
