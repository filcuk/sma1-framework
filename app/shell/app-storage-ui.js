/**
 * Footer shield control: privacy popover on hover; optional menu to clear /
 * disable app storage when `manage` is true. Theme preference is never cleared
 * or disabled here.
 */

import { initDialog } from "../components/dialog.js";
import { initPopover } from "../components/popover.js";
import { flashTooltip } from "../components/tooltip.js";
import {
  clearAppStorage,
  getAppStorageSnapshot,
  isAppStorageEnabled,
  isAppStorageInitialized,
  setAppStorageEnabled,
} from "../utils/app-storage.js";
import { setHidden } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";
import { initPopupMenu } from "../utils/menu.js";

const PRIVACY_HIDE_MS = 120;
const CONFIRM_DIALOG_ID = "footer-storage-confirm";

/**
 * Privacy popover body for the footer shield. Edit this node tree to add
 * formatting (links, emphasis, extra paragraphs, etc.).
 *
 * Use `textContent` for plain text. Use `innerHTML` (trusted markup only) or
 * DOM nodes when you need tags such as `<strong>`.
 *
 * @param {{ manage?: boolean }} [options]
 *   When `manage` is false, omit status / clear-disable copy (privacy notice only).
 * @returns {HTMLElement}
 */
export function createFooterStoragePrivacyBody({ manage = true } = {}) {
  const root = document.createElement("div");
  root.className = "footer-storage-privacy-body";

  const p1 = document.createElement("p");
  p1.className = "popover__text";
  p1.innerHTML =
    "This is a <em>static site</em>. <br />All data remains <em>safely on your device</em>. <br /><em>No tracking or fingerprinting</em> is used.";

  root.append(p1);

  if (!manage) return root;

  const p2 = document.createElement("p");
  p2.className = "popover__text";
  p2.innerHTML =
    "The site <em>may store configuration and inputs</em> in your browser. Disabling this may degrade your experience.";

  const status = document.createElement("p");
  status.className = "popover__text";
  status.dataset.storagePrivacyStatus = "";

  const p3 = document.createElement("p");
  p3.className = "popover__text";
  p3.innerHTML = "<strong>Select shield to manage local storage.</strong>";

  root.append(p2, status, p3);
  return root;
}

/**
 * @param {HTMLElement | null | undefined} statusEl
 */
function syncPrivacyStatus(statusEl) {
  if (!(statusEl instanceof HTMLElement)) return;
  const enabled = isAppStorageEnabled();
  const state = enabled ? "enabled" : "disabled";
  statusEl.innerHTML = `Local storage is <strong>${state}</strong>.`;
}

/**
 * @returns {boolean}
 */
function hasStoredData() {
  return getAppStorageSnapshot().keyCount > 0;
}

/**
 * @returns {HTMLElement}
 */
function ensureConfirmDialogEl() {
  const existing = document.getElementById(CONFIRM_DIALOG_ID);
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = CONFIRM_DIALOG_ID;
  el.className = "modal hidden";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", `${CONFIRM_DIALOG_ID}-title`);
  el.hidden = true;
  el.innerHTML = `
    <div class="modal-backdrop" data-dialog-close></div>
    <div class="modal-panel">
      <div class="modal-header">
        <h2 id="${CONFIRM_DIALOG_ID}-title"></h2>
        <button type="button" class="modal-close" aria-label="Close" data-dialog-close></button>
      </div>
      <div class="modal-body">
        <p data-storage-confirm-body></p>
      </div>
      <div class="modal-footer">
        <div class="modal-footer-actions">
          <button type="button" class="btn" data-dialog-close data-dialog-default>Cancel</button>
          <button type="button" class="btn btn-danger" data-storage-confirm-ok>Confirm</button>
        </div>
      </div>
    </div>
  `;
  el.querySelector(".modal-close")?.append(
    createIcon("clear", { className: "modal-close-icon" }),
  );
  document.body.append(el);
  return el;
}

/**
 * Sync enable/disable label, clear-item visibility, shield colour, and privacy status.
 *
 * @param {ParentNode} containerEl
 * @param {HTMLElement | null | undefined} [statusEl]
 */
function syncStorageMenu(containerEl, statusEl) {
  const ready = isAppStorageInitialized();
  const enabled = isAppStorageEnabled();
  const trigger = containerEl.querySelector(".footer-storage-trigger");
  if (trigger instanceof HTMLElement) {
    trigger.classList.toggle(
      "footer-storage-trigger--disabled",
      ready && !enabled,
    );
  }
  const toggleLabel = containerEl.querySelector("[data-storage-toggle-label]");
  if (toggleLabel) {
    toggleLabel.textContent = enabled
      ? "Disable local storage"
      : "Enable local storage";
  }

  const clearItem = containerEl.querySelector("[data-storage-clear-item]");
  if (clearItem instanceof HTMLElement) {
    setHidden(clearItem, !ready || !enabled);
  }

  const clearBtn = containerEl.querySelector('[data-storage-action="clear"]');
  if (clearBtn instanceof HTMLButtonElement) {
    clearBtn.disabled =
      !ready || !enabled || getAppStorageSnapshot().keyCount === 0;
  }

  containerEl.querySelectorAll("[data-storage-action]").forEach((item) => {
    if (!(item instanceof HTMLButtonElement)) return;
    if (item.dataset.storageAction === "clear") return;
    item.disabled = !ready;
  });

  syncPrivacyStatus(statusEl);
}

/**
 * @param {HTMLElement} trigger
 * @param {ReturnType<typeof initPopover>} privacyPopover
 * @param {() => void} [onBeforeShow]
 * @param {() => boolean} [shouldSkipShow]
 */
function bindPrivacyHover(trigger, privacyPopover, onBeforeShow, shouldSkipShow) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let hideTimer = null;
  const privacyEl = privacyPopover.getElement();

  function clearHideTimer() {
    if (hideTimer == null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function showPrivacy() {
    if (shouldSkipShow?.()) return;
    onBeforeShow?.();
    clearHideTimer();
    privacyPopover.open();
  }

  function scheduleHidePrivacy() {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      privacyPopover.close({ restoreFocus: false });
    }, PRIVACY_HIDE_MS);
  }

  function hidePrivacyNow() {
    clearHideTimer();
    privacyPopover.close({ restoreFocus: false });
  }

  const onTriggerPointerEnter = () => showPrivacy();
  const onTriggerPointerLeave = () => scheduleHidePrivacy();
  const onPopoverPointerEnter = () => {
    clearHideTimer();
  };
  const onPopoverPointerLeave = () => scheduleHidePrivacy();
  const onTriggerFocusIn = () => {
    if (trigger.matches(":focus-visible")) showPrivacy();
  };
  const onTriggerFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && privacyEl.contains(next)) return;
    scheduleHidePrivacy();
  };

  trigger.addEventListener("pointerenter", onTriggerPointerEnter);
  trigger.addEventListener("pointerleave", onTriggerPointerLeave);
  trigger.addEventListener("focusin", onTriggerFocusIn);
  trigger.addEventListener("focusout", onTriggerFocusOut);
  privacyEl.addEventListener("pointerenter", onPopoverPointerEnter);
  privacyEl.addEventListener("pointerleave", onPopoverPointerLeave);

  return {
    hidePrivacyNow,
    destroy() {
      clearHideTimer();
      trigger.removeEventListener("pointerenter", onTriggerPointerEnter);
      trigger.removeEventListener("pointerleave", onTriggerPointerLeave);
      trigger.removeEventListener("focusin", onTriggerFocusIn);
      trigger.removeEventListener("focusout", onTriggerFocusOut);
      privacyEl.removeEventListener("pointerenter", onPopoverPointerEnter);
      privacyEl.removeEventListener("pointerleave", onPopoverPointerLeave);
      privacyPopover.destroy();
    },
  };
}

/**
 * Wire the footer shield privacy popover, and optionally the manage menu.
 *
 * @param {ParentNode} [root=document]
 * @param {{ manage?: boolean }} [options]
 *   `manage: false` = privacy notice only (no clear/disable menu or confirm UI).
 * @returns {{ destroy: () => void, isOpen?: () => boolean } | null}
 */
export function initAppStorageUi(root = document, options = {}) {
  const manage = options.manage !== false;
  const containerEl =
    root.querySelector?.("#footer-storage") ??
    document.getElementById("footer-storage");
  if (!containerEl) return null;

  const trigger = containerEl.querySelector(".footer-storage-trigger");
  if (!(trigger instanceof HTMLElement)) return null;

  const privacyBody = createFooterStoragePrivacyBody({ manage });
  const privacyStatusEl = privacyBody.querySelector(
    "[data-storage-privacy-status]",
  );

  const privacyPopover = initPopover({
    anchor: trigger,
    body: privacyBody,
    position: "top",
    dismissible: false,
    closeOnOutsideClick: false,
    trapFocus: false,
    focusOnOpen: false,
    className: "footer-storage-privacy-popover",
  });

  if (!manage) {
    const hover = bindPrivacyHover(trigger, privacyPopover);
    return {
      isOpen: () => false,
      destroy() {
        hover.destroy();
      },
    };
  }

  const menuEl = containerEl.querySelector(".footer-storage-menu");
  if (!menuEl) {
    privacyPopover.destroy();
    return null;
  }

  const syncUi = () => syncStorageMenu(containerEl, privacyStatusEl);
  syncUi();

  /** @type {"clear" | "disable" | null} */
  let pendingConfirm = null;
  const confirmEl = ensureConfirmDialogEl();
  const confirmTitle = confirmEl.querySelector(`#${CONFIRM_DIALOG_ID}-title`);
  const confirmBody = confirmEl.querySelector("[data-storage-confirm-body]");
  const confirmOk = confirmEl.querySelector("[data-storage-confirm-ok]");
  const confirmDialog = initDialog({ dialogEl: confirmEl });

  /**
   * @param {"clear" | "disable"} action
   */
  function openStorageConfirm(action) {
    pendingConfirm = action;
    if (confirmTitle) {
      confirmTitle.textContent =
        action === "clear" ? "Clear stored data?" : "Disable local storage?";
    }
    if (confirmBody) {
      confirmBody.textContent =
        action === "clear"
          ? "This clears configuration and inputs saved for this app in your browser. Theme preference is kept. This cannot be undone."
          : "This disables local storage and clears configuration and inputs saved for this app. Theme preference is kept. This cannot be undone.";
    }
    if (confirmOk instanceof HTMLButtonElement) {
      confirmOk.textContent =
        action === "clear" ? "Clear data" : "Disable and clear";
    }
    confirmDialog?.openDialog();
  }

  function onConfirmOk() {
    const action = pendingConfirm;
    pendingConfirm = null;
    confirmDialog?.closeDialog();
    if (action === "clear") {
      const ok = clearAppStorage();
      flashTooltip(trigger, {
        text: ok ? "Stored data cleared" : "Nothing to clear",
        tone: ok ? "success" : "info",
        maxWidth: "16rem",
      });
    } else if (action === "disable") {
      const ok = setAppStorageEnabled(false);
      flashTooltip(trigger, {
        text: ok ? "Local storage disabled" : "Storage unavailable",
        tone: ok ? "success" : "error",
        maxWidth: "16rem",
      });
    }
    syncUi();
  }

  confirmOk?.addEventListener("click", onConfirmOk);

  const hover = bindPrivacyHover(
    trigger,
    privacyPopover,
    () => syncUi(),
    () =>
      trigger.getAttribute("aria-expanded") === "true" ||
      Boolean(confirmDialog?.isDialogOpen()),
  );

  const onTogglePointer = () => {
    hover.hidePrivacyNow();
    syncUi();
  };
  const onToggleKeydown = (event) => {
    if (
      event.key !== "Enter" &&
      event.key !== " " &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    hover.hidePrivacyNow();
    syncUi();
  };
  trigger.addEventListener("pointerdown", onTogglePointer);
  trigger.addEventListener("keydown", onToggleKeydown);

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
        if (!hasStoredData()) {
          flashTooltip(trigger, {
            text: "Nothing to clear",
            tone: "info",
            maxWidth: "16rem",
          });
          return;
        }
        openStorageConfirm("clear");
        return;
      }
      if (action === "toggle") {
        if (isAppStorageEnabled()) {
          if (hasStoredData()) {
            openStorageConfirm("disable");
            return;
          }
          const ok = setAppStorageEnabled(false);
          flashTooltip(trigger, {
            text: ok ? "Local storage disabled" : "Storage unavailable",
            tone: ok ? "success" : "error",
            maxWidth: "16rem",
          });
          syncUi();
          return;
        }
        const ok = setAppStorageEnabled(true);
        flashTooltip(trigger, {
          text: ok ? "Local storage enabled" : "Storage unavailable",
          tone: ok ? "success" : "error",
          maxWidth: "16rem",
        });
        syncUi();
      }
    },
  });

  if (!menuApi) {
    confirmOk?.removeEventListener("click", onConfirmOk);
    confirmDialog?.destroy();
    confirmEl.remove();
    trigger.removeEventListener("pointerdown", onTogglePointer);
    trigger.removeEventListener("keydown", onToggleKeydown);
    hover.destroy();
    return null;
  }

  const originalDestroy = menuApi.destroy;
  return {
    ...menuApi,
    destroy() {
      trigger.removeEventListener("pointerdown", onTogglePointer);
      trigger.removeEventListener("keydown", onToggleKeydown);
      confirmOk?.removeEventListener("click", onConfirmOk);
      confirmDialog?.destroy();
      confirmEl.remove();
      hover.destroy();
      originalDestroy?.();
    },
  };
}
