import { parseBooleanAttr, setHidden } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";

/**
 * Segmented file control (combo-style), large dropzone host, and fullscreen
 * page-drop overlay.
 *
 * Row markup (default):
 *   <div class="file" data-file-download …>
 *     <ul class="file-list">… .file-item …</ul>
 *   </div>
 *
 * Large dropzone:
 *   <div class="file file--large" data-file-accept=".json" data-file-multiple data-file-max="5">
 *     <input type="file" class="file-input" hidden />
 *     <button type="button" class="file-prompt">…</button>
 *     <ul class="file-list hidden" hidden></ul>
 *   </div>
 *
 * Fullscreen overlay:
 *   <div class="file file--fullscreen hidden" hidden data-file-accept="image/*">
 *     <input type="file" class="file-input" hidden />
 *     <button type="button" class="file-prompt">…</button>
 *   </div>
 *
 * Row defaults: download on, remove off, upload off.
 * Large defaults: remove on, download off, upload off; size meta always visible.
 * Fullscreen defaults: activate on document file-drag (hide after drop); `onFiles` only.
 * Name action: none | download | upload | remove | custom (via onNameAction).
 * Ext / size visibility: hover | always | never (independent).
 */

const DEFAULT_MIME_TYPE = "text/plain;charset=utf-8";

const NAME_ACTIONS = new Set(["none", "download", "upload", "remove", "custom"]);
const VISIBILITY_MODES = new Set(["hover", "always", "never"]);

/**
 * @param {string | null | undefined} accept
 * @returns {string[]}
 */
export function parseAcceptTokens(accept) {
  return String(accept ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether a file matches an HTML `accept`-style list (extensions and/or MIME types).
 * Empty accept matches every file. Extension tokens use the final `.ext` (case-insensitive);
 * multi-dot tokens like `.tar.gz` use a suffix match. MIME tokens match `file.type`
 * (`image/*` matches any image MIME).
 *
 * @param {{ name?: string, type?: string }} file
 * @param {string | string[] | null | undefined} accept
 */
export function fileMatchesAccept(file, accept) {
  const tokens = Array.isArray(accept) ? accept : parseAcceptTokens(accept);
  if (!tokens.length) return true;

  const name = String(file?.name ?? "")
    .trim()
    .toLowerCase();
  const type = String(file?.type ?? "")
    .trim()
    .toLowerCase();

  return tokens.some((token) => {
    if (token.startsWith(".")) {
      if (token.indexOf(".", 1) !== -1) {
        return name.endsWith(token);
      }
      const dot = name.lastIndexOf(".");
      return dot >= 0 && name.slice(dot) === token;
    }
    if (token.endsWith("/*")) {
      const prefix = token.slice(0, -1);
      return Boolean(type) && type.startsWith(prefix);
    }
    return Boolean(type) && type === token;
  });
}

/**
 * @param {string | null | undefined} value
 * @returns {"strict" | "soft"}
 */
export function resolveAcceptFilter(value) {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (trimmed === "soft") return "soft";
  return "strict";
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveByteLength(content) {
  if (typeof content === "string") {
    return new TextEncoder().encode(content).byteLength;
  }
  if (content instanceof Blob) return content.size;
  if (content instanceof ArrayBuffer) return content.byteLength;
  return 0;
}

async function resolveContent(getContent, fallbackContent) {
  if (getContent) return getContent();
  return fallbackContent ?? "";
}

function toBlob(content, mimeType) {
  if (content instanceof Blob) return content;
  if (content instanceof ArrayBuffer) {
    return new Blob([content], { type: mimeType });
  }
  return new Blob([String(content)], { type: mimeType });
}

/**
 * Trigger a browser download for the given content.
 *
 * @param {{ filename: string, content?: string | Blob | ArrayBuffer, mimeType?: string, getContent?: () => string | Blob | ArrayBuffer | Promise<string | Blob | ArrayBuffer> }} options
 */
export async function downloadFile({
  filename,
  content,
  mimeType = DEFAULT_MIME_TYPE,
  getContent,
} = {}) {
  const resolved = await resolveContent(getContent, content);
  const blob = toBlob(resolved, mimeType);
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { filename, size: blob.size };
}

/**
 * @param {string | null | undefined} value
 * @param {"none" | "download" | "upload" | "remove" | "custom"} fallback
 */
function resolveNameAction(value, fallback = "none") {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (NAME_ACTIONS.has(trimmed)) return /** @type {typeof fallback} */ (trimmed);
  return fallback;
}

/**
 * @param {string | null | undefined} value
 * @param {"hover" | "always" | "never"} fallback
 */
function resolveVisibility(value, fallback = "hover") {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (VISIBILITY_MODES.has(trimmed)) return /** @type {typeof fallback} */ (trimmed);
  return fallback;
}

function readFilename(sourceEl, fallback) {
  return (
    sourceEl?.dataset.fileName?.trim() ||
    sourceEl?.dataset.fileDownloadName?.trim() ||
    fallback ||
    "download.txt"
  );
}

function readMimeType(sourceEl, fallback) {
  return (
    sourceEl?.dataset.fileMime?.trim() ||
    sourceEl?.dataset.fileDownloadMime?.trim() ||
    fallback ||
    DEFAULT_MIME_TYPE
  );
}

function splitFilename(filename) {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return { stem: filename, ext: "" };
  return {
    stem: filename.slice(0, lastDot),
    ext: filename.slice(lastDot),
  };
}

function applyVisibilityClasses(itemEl, { extVisibility, sizeVisibility }) {
  itemEl.classList.remove(
    "file-item--ext-hover",
    "file-item--ext-always",
    "file-item--ext-never",
    "file-item--size-hover",
    "file-item--size-always",
    "file-item--size-never"
  );
  itemEl.classList.add(`file-item--ext-${extVisibility}`);
  itemEl.classList.add(`file-item--size-${sizeVisibility}`);
}

function updateItemMeta(itemEl, { filename, byteLength }) {
  const nameEl = itemEl.querySelector(".file-item-name");
  const extEl = itemEl.querySelector(".file-item-ext");
  const metaEl = itemEl.querySelector(".file-item-meta");
  const { stem, ext } = splitFilename(filename);

  if (nameEl) nameEl.textContent = stem;
  if (extEl) {
    extEl.textContent = ext;
    setHidden(extEl, !ext);
  }
  if (metaEl) {
    const label = byteLength ? formatFileSize(byteLength) : "";
    metaEl.textContent = label;
    setHidden(metaEl, !label);
  }
}

function ensureIcon(buttonEl, iconId) {
  const hasIcon =
    buttonEl.querySelector(".btn-icon-svg") ||
    buttonEl.querySelector(`[data-icon="${iconId}"]`);
  if (!hasIcon) {
    buttonEl.append(createIcon(iconId, { className: "btn-icon-svg" }));
  }
}

/**
 * @param {HTMLElement} itemEl
 * @param {"download" | "upload" | "remove"} kind
 * @param {string} filename
 * @param {boolean} enabled
 */
function ensureSegment(itemEl, kind, filename, enabled) {
  const className = `file-item-${kind}`;
  let segment = itemEl.querySelector(`.${className}`);

  if (!enabled) {
    segment?.remove();
    return null;
  }

  if (!segment) {
    segment = document.createElement("button");
    segment.type = "button";
    segment.className = `btn ${className}`;
    itemEl.append(segment);
  }

  segment.type = "button";
  segment.classList.add("btn", className);

  const labels = {
    download: `Download ${filename}`,
    upload: `Replace ${filename}`,
    remove: `Remove ${filename}`,
  };
  segment.setAttribute("aria-label", labels[kind]);

  const icons = {
    download: "download",
    upload: "upload",
    remove: "remove-circle",
  };
  ensureIcon(segment, icons[kind]);

  return segment;
}

/**
 * Ensure main name segment exists. Returns the main element.
 * @param {HTMLElement} itemEl
 * @param {{ nameAction: string, filename: string }} options
 */
function ensureMain(itemEl, { nameAction, filename }) {
  let main = itemEl.querySelector(".file-item-main");
  const wantsButton = nameAction !== "none";

  if (!main) {
    main = document.createElement(wantsButton ? "button" : "div");
    if (wantsButton) /** @type {HTMLButtonElement} */ (main).type = "button";
    main.className = "btn file-item-main";
    itemEl.prepend(main);
  }

  main.classList.add("btn", "file-item-main");
  if (main instanceof HTMLButtonElement) {
    main.type = "button";
    if (nameAction === "none") {
      main.setAttribute("aria-disabled", "true");
    } else {
      main.removeAttribute("aria-disabled");
      main.setAttribute("aria-label", `${nameAction} ${filename}`);
    }
  } else if (wantsButton) {
    // Author used a non-button; keep it interactive via role when action is set.
    main.setAttribute("role", "button");
    main.tabIndex = 0;
    main.setAttribute("aria-label", `${nameAction} ${filename}`);
  } else {
    main.removeAttribute("role");
    main.removeAttribute("tabindex");
    main.removeAttribute("aria-label");
  }

  if (!main.querySelector(".file-item-name")) {
    const nameEl = document.createElement("span");
    nameEl.className = "file-item-name";
    main.append(nameEl);
  }
  if (!main.querySelector(".file-item-ext")) {
    const extEl = document.createElement("span");
    extEl.className = "file-item-ext";
    main.append(extEl);
  }
  if (!main.querySelector(".file-item-meta")) {
    const metaEl = document.createElement("span");
    metaEl.className = "file-item-meta";
    main.append(metaEl);
  }

  return main;
}

function bindClick(el, handler) {
  if (!el) return () => {};
  el.addEventListener("click", handler);
  return () => el.removeEventListener("click", handler);
}

/**
 * @param {string | undefined} option
 * @param {HTMLElement} fileEl
 * @returns {"default" | "large" | "fullscreen"}
 */
function resolveVariant(option, fileEl) {
  const fromOption = String(option ?? "")
    .trim()
    .toLowerCase();
  if (fromOption === "large" || fromOption === "fullscreen" || fromOption === "default") {
    return /** @type {"default" | "large" | "fullscreen"} */ (fromOption);
  }
  if (fileEl.classList.contains("file--fullscreen")) return "fullscreen";
  if (fileEl.classList.contains("file--large")) return "large";
  return "default";
}

/** Human-readable label for one `accept` token (e.g. `.json` → `JSON`, `image/*` → `Images`). */
function formatAcceptToken(token) {
  const value = token.trim();
  if (!value) return "";

  if (value.startsWith(".")) {
    return value.slice(1).toUpperCase();
  }

  const slash = value.indexOf("/");
  if (slash !== -1) {
    const type = value.slice(0, slash);
    const subtype = value.slice(slash + 1);
    if (subtype === "*") {
      if (type === "image") return "Images";
      if (type === "audio") return "Audio";
      if (type === "video") return "Videos";
      return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    }
    return subtype.toUpperCase();
  }

  return value;
}

function formatAcceptLabel(accept) {
  if (!accept?.trim()) return "";
  return accept
    .split(",")
    .map(formatAcceptToken)
    .filter(Boolean)
    .join(", ");
}

function formatFilesLabel(max) {
  if (max && Number.isFinite(max) && max > 0) {
    return `Up to ${max} file${max === 1 ? "" : "s"}`;
  }
  return "Multiple files";
}

function formatConstraintsLabel(acceptTypes, isMultiple, max) {
  const parts = [];
  const acceptLabel = formatAcceptLabel(acceptTypes);
  if (acceptLabel) parts.push(acceptLabel);
  if (isMultiple) parts.push(formatFilesLabel(max));
  return parts.join(" · ");
}

function syncInputFiles(input, files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
}

/**
 * @param {HTMLElement} fileEl
 * @param {object} [options]
 */
export function initFile(fileEl, options = {}) {
  if (!fileEl) return null;
  const variant = resolveVariant(options.variant, fileEl);
  if (variant === "large") return initFileLarge(fileEl, options);
  if (variant === "fullscreen") return initFileFullscreen(fileEl, options);
  return initFileRows(fileEl, options);
}

/**
 * @param {HTMLElement} fileEl
 * @param {object} [options]
 */
function initFileRows(fileEl, options = {}) {
  const {
    filename: hostFilename,
    mimeType: hostMimeType,
    content: hostContent,
    getContent: hostGetContent,
    files: filesOption,
    onDownload,
    onUpload,
    onRemove,
    onNameAction,
    onError,
  } = options;

  const hostDownload =
    options.download ?? parseBooleanAttr(fileEl.dataset.fileDownload) ?? true;
  const hostRemove =
    options.remove ?? parseBooleanAttr(fileEl.dataset.fileRemove) ?? false;
  const hostUpload =
    options.upload ?? parseBooleanAttr(fileEl.dataset.fileUpload) ?? false;
  const hostNameAction = resolveNameAction(
    options.nameAction ?? fileEl.dataset.fileNameAction,
    "none"
  );
  const hostExtVisibility = resolveVisibility(
    options.extVisibility ?? fileEl.dataset.fileExtVisibility,
    "hover"
  );
  const hostSizeVisibility = resolveVisibility(
    options.sizeVisibility ?? fileEl.dataset.fileSizeVisibility,
    "hover"
  );
  const acceptTypes = options.accept ?? fileEl.dataset.fileAccept ?? "";
  const acceptTokens = parseAcceptTokens(acceptTypes);
  const acceptFilterMode = resolveAcceptFilter(
    typeof options.acceptFilter === "string"
      ? options.acceptFilter
      : fileEl.dataset.fileAcceptFilter
  );
  const hostDropActive =
    options.dropActive ?? parseBooleanAttr(fileEl.dataset.fileDropActive) ?? false;

  const items = [...fileEl.querySelectorAll(".file-item")];
  if (!items.length) return null;

  /** @type {Array<() => void>} */
  const cleanups = [];
  /** @type {Array<{
   *   itemEl: HTMLElement,
   *   filename: string,
   *   mimeType: string,
   *   content: unknown,
   *   getContent: (() => unknown) | undefined,
   *   download: boolean,
   *   remove: boolean,
   *   upload: boolean,
   *   nameAction: string,
   *   input: HTMLInputElement | null,
   * }>} */
  const itemStates = [];

  /**
   * @param {number} index
   * @param {File} file
   */
  function applyUploadedFile(index, file) {
    const state = itemStates[index];
    if (!state) return;

    state.filename = file.name;
    state.mimeType = file.type || state.mimeType;
    state.content = file;
    state.getContent = undefined;

    const main = state.itemEl.querySelector(".file-item-main");
    if (main) {
      main.dataset.fileName = file.name;
      if (file.type) main.dataset.fileMime = file.type;
    }

    updateItemMeta(state.itemEl, {
      filename: state.filename,
      byteLength: file.size,
    });

    if (state.download) {
      ensureSegment(state.itemEl, "download", state.filename, true);
    }
    if (state.upload) {
      ensureSegment(state.itemEl, "upload", state.filename, true);
    }
    if (state.remove) {
      ensureSegment(state.itemEl, "remove", state.filename, true);
    }

    onUpload?.({
      fileEl,
      itemEl: state.itemEl,
      index,
      file,
      filename: state.filename,
    });
  }

  /**
   * @param {number} index
   * @param {File[]} incoming
   */
  function partitionIncoming(incoming) {
    if (!acceptTokens.length || acceptFilterMode === "soft") {
      return { accepted: incoming, rejected: [] };
    }
    /** @type {File[]} */
    const accepted = [];
    /** @type {File[]} */
    const rejected = [];
    for (const file of incoming) {
      if (fileMatchesAccept(file, acceptTokens)) accepted.push(file);
      else rejected.push(file);
    }
    return { accepted, rejected };
  }

  /**
   * @param {File[]} rejected
   */
  function reportRejected(rejected) {
    if (!rejected.length) return;
    const message =
      rejected.length === 1
        ? `"${rejected[0].name}" is not an accepted file type.`
        : `${rejected.length} files were not an accepted type.`;
    onError?.({
      fileEl,
      message,
      files: rejected,
      reason: "accept",
    });
  }

  /**
   * @param {number} index
   * @param {File[]} incoming
   */
  function handleIncomingFiles(index, incoming) {
    if (!incoming.length) return;
    const { accepted, rejected } = partitionIncoming(incoming);
    reportRejected(rejected);
    if (!accepted.length) return;
    applyUploadedFile(index, accepted[0]);
  }

  async function runDownload(index) {
    const state = itemStates[index];
    if (!state) return null;
    const result = await downloadFile({
      filename: state.filename,
      content: /** @type {string | Blob | ArrayBuffer | undefined} */ (state.content),
      mimeType: state.mimeType,
      getContent: /** @type {(() => string | Blob | ArrayBuffer | Promise<string | Blob | ArrayBuffer>) | undefined} */ (
        state.getContent
      ),
    });
    onDownload?.({
      fileEl,
      itemEl: state.itemEl,
      index,
      filename: state.filename,
      size: result.size,
    });
    return result;
  }

  function runRemove(index) {
    const state = itemStates[index];
    if (!state) return;

    onRemove?.({
      fileEl,
      itemEl: state.itemEl,
      index,
      filename: state.filename,
    });

    const listItem = state.itemEl.closest("li");
    (listItem ?? state.itemEl).remove();
    itemStates[index] = /** @type {any} */ (null);
  }

  function openPickerFor(index) {
    const state = itemStates[index];
    if (!state?.input) return;
    state.input.value = "";
    state.input.click();
  }

  function runNameAction(index) {
    const state = itemStates[index];
    if (!state) return;

    switch (state.nameAction) {
      case "download":
        void runDownload(index);
        break;
      case "upload":
        openPickerFor(index);
        break;
      case "remove":
        runRemove(index);
        break;
      case "custom":
        onNameAction?.({
          fileEl,
          itemEl: state.itemEl,
          index,
          filename: state.filename,
        });
        break;
      default:
        break;
    }
  }

  items.forEach((itemEl, index) => {
    const fromOptions = /** @type {Record<string, any>} */ (filesOption?.[index] ?? {});
    const mainSource =
      itemEl.querySelector(".file-item-main") ??
      itemEl.querySelector("[data-file-name]") ??
      itemEl;

    const filename =
      fromOptions.filename ?? readFilename(mainSource, hostFilename);
    const mimeType =
      fromOptions.mimeType ?? readMimeType(mainSource, hostMimeType);
    const content = fromOptions.content ?? hostContent;
    const getContent = fromOptions.getContent ?? hostGetContent;

    const download =
      fromOptions.download ??
      parseBooleanAttr(
        /** @type {HTMLElement} */ (mainSource).dataset?.fileDownload
      ) ??
      hostDownload;
    const remove =
      fromOptions.remove ??
      parseBooleanAttr(
        /** @type {HTMLElement} */ (mainSource).dataset?.fileRemove
      ) ??
      hostRemove;
    const upload =
      fromOptions.upload ??
      parseBooleanAttr(
        /** @type {HTMLElement} */ (mainSource).dataset?.fileUpload
      ) ??
      hostUpload;
    const nameAction = resolveNameAction(
      fromOptions.nameAction ??
        /** @type {HTMLElement} */ (mainSource).dataset?.fileNameAction,
      hostNameAction
    );
    const extVisibility = resolveVisibility(
      fromOptions.extVisibility ??
        /** @type {HTMLElement} */ (mainSource).dataset?.fileExtVisibility,
      hostExtVisibility
    );
    const sizeVisibility = resolveVisibility(
      fromOptions.sizeVisibility ??
        /** @type {HTMLElement} */ (mainSource).dataset?.fileSizeVisibility,
      hostSizeVisibility
    );
    const dropActive =
      fromOptions.dropActive ??
      parseBooleanAttr(
        /** @type {HTMLElement} */ (mainSource).dataset?.fileDropActive
      ) ??
      hostDropActive;

    const main = ensureMain(itemEl, { nameAction, filename });
    main.dataset.fileName = filename;
    applyVisibilityClasses(itemEl, { extVisibility, sizeVisibility });

    const downloadBtn = ensureSegment(itemEl, "download", filename, download);
    const uploadBtn = ensureSegment(itemEl, "upload", filename, upload);
    const removeBtn = ensureSegment(itemEl, "remove", filename, remove);

    /** @type {HTMLInputElement | null} */
    let input = null;
    if (upload) {
      const listItem = itemEl.closest("li") ?? itemEl;
      input = listItem.querySelector(":scope > .file-item-input");
      if (!input) {
        input = document.createElement("input");
        input.type = "file";
        input.className = "file-item-input";
        input.hidden = true;
        listItem.append(input);
      }
      if (acceptTypes) input.accept = acceptTypes;
      input.multiple = false;

      const onInputChange = () => {
        const incoming = [...(input?.files ?? [])];
        if (!incoming.length) return;
        handleIncomingFiles(index, incoming);
      };
      input.addEventListener("change", onInputChange);
      cleanups.push(() => input?.removeEventListener("change", onInputChange));
    }

    const state = {
      itemEl,
      filename,
      mimeType,
      content,
      getContent,
      download,
      remove,
      upload,
      nameAction,
      input,
    };
    itemStates[index] = state;

    void resolveContent(getContent, content).then((resolved) => {
      if (!itemStates[index]) return;
      updateItemMeta(itemEl, {
        filename: itemStates[index].filename,
        byteLength: resolveByteLength(resolved),
      });
    });

    if (nameAction !== "none") {
      cleanups.push(bindClick(main, () => runNameAction(index)));
    }

    if (downloadBtn) {
      cleanups.push(bindClick(downloadBtn, () => {
        void runDownload(index);
      }));
    }

    if (uploadBtn && input) {
      cleanups.push(bindClick(uploadBtn, () => openPickerFor(index)));
    }

    if (removeBtn) {
      cleanups.push(bindClick(removeBtn, () => runRemove(index)));
    }

    if (upload && dropActive) {
      let dragDepth = 0;

      function setDragover(active) {
        itemEl.classList.toggle("is-dragover", active);
      }

      function onDragEnter(event) {
        event.preventDefault();
        dragDepth += 1;
        setDragover(true);
      }

      function onDragOver(event) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }

      function onDragLeave(event) {
        event.preventDefault();
        dragDepth -= 1;
        if (dragDepth <= 0) {
          dragDepth = 0;
          setDragover(false);
        }
      }

      function onDrop(event) {
        event.preventDefault();
        dragDepth = 0;
        setDragover(false);
        const incoming = [...(event.dataTransfer?.files ?? [])];
        if (!incoming.length) return;
        handleIncomingFiles(index, incoming);
      }

      itemEl.addEventListener("dragenter", onDragEnter);
      itemEl.addEventListener("dragover", onDragOver);
      itemEl.addEventListener("dragleave", onDragLeave);
      itemEl.addEventListener("drop", onDrop);
      cleanups.push(() => {
        itemEl.removeEventListener("dragenter", onDragEnter);
        itemEl.removeEventListener("dragover", onDragOver);
        itemEl.removeEventListener("dragleave", onDragLeave);
        itemEl.removeEventListener("drop", onDrop);
        dragDepth = 0;
        setDragover(false);
      });
    }
  });

  return {
    download: (index = 0) => runDownload(index),
    openPicker: (index = 0) => openPickerFor(index),
    remove: (index = 0) => runRemove(index),
    getFilename: (index = 0) => itemStates[index]?.filename ?? null,
    destroy: () => {
      cleanups.forEach((cleanup) => cleanup());
      cleanups.length = 0;
    },
  };
}

/**
 * Large dropzone host (`.file.file--large`). Selected files render as segmented
 * `.file-item` rows (remove on by default; download / upload off).
 *
 * @param {HTMLElement} fileEl
 * @param {object} [options]
 */
function initFileLarge(fileEl, options = {}) {
  const input = fileEl.querySelector(".file-input");
  const prompt = fileEl.querySelector(".file-prompt");
  const list = fileEl.querySelector(".file-list");
  if (!input || !prompt) return null;

  const {
    onFiles,
    onError,
    onClear,
    onDownload,
    onUpload,
    onRemove,
    onNameAction,
  } = options;

  const acceptTypes = options.accept ?? fileEl.dataset.fileAccept ?? "";
  const acceptTokens = parseAcceptTokens(acceptTypes);
  const acceptFilterMode = resolveAcceptFilter(
    typeof options.acceptFilter === "string"
      ? options.acceptFilter
      : fileEl.dataset.fileAcceptFilter
  );
  const isMultiple =
    options.multiple ?? parseBooleanAttr(fileEl.dataset.fileMultiple) ?? false;
  const max =
    options.maxFiles ??
    (fileEl.dataset.fileMax ? Number(fileEl.dataset.fileMax) : undefined);

  // Large defaults: remove on, download/upload off (selection list, not export).
  const hostDownload =
    options.download ?? parseBooleanAttr(fileEl.dataset.fileDownload) ?? false;
  const hostRemove =
    options.remove ?? parseBooleanAttr(fileEl.dataset.fileRemove) ?? true;
  const hostUpload =
    options.upload ?? parseBooleanAttr(fileEl.dataset.fileUpload) ?? false;
  const hostNameAction = resolveNameAction(
    options.nameAction ?? fileEl.dataset.fileNameAction,
    "none"
  );
  const hostExtVisibility = resolveVisibility(
    options.extVisibility ?? fileEl.dataset.fileExtVisibility,
    "hover"
  );
  const hostSizeVisibility = resolveVisibility(
    options.sizeVisibility ?? fileEl.dataset.fileSizeVisibility,
    "always"
  );

  if (acceptTypes) input.accept = acceptTypes;
  input.multiple = isMultiple;
  if (acceptFilterMode === "soft") {
    fileEl.dataset.fileAcceptFilter = "soft";
  } else {
    delete fileEl.dataset.fileAcceptFilter;
  }

  const constraintsLabel = formatConstraintsLabel(acceptTypes, isMultiple, max);
  const text = prompt.querySelector(".file-prompt-text") ?? prompt;
  let meta = text.querySelector(".file-prompt-meta");
  if (constraintsLabel) {
    if (!meta) {
      meta = document.createElement("span");
      meta.className = "file-prompt-meta";
      text.append(meta);
    }
    meta.textContent = constraintsLabel;
    setHidden(meta, false);
  } else if (meta) {
    meta.textContent = "";
    setHidden(meta, true);
  }

  /** @type {File[]} */
  let files = [];
  let dragDepth = 0;
  /** @type {Array<() => void>} */
  let listCleanups = [];

  function setDragover(active) {
    fileEl.classList.toggle("is-dragover", active);
  }

  function partitionByAccept(incoming) {
    if (!acceptTokens.length || acceptFilterMode === "soft") {
      return { accepted: incoming, rejected: [] };
    }
    /** @type {File[]} */
    const accepted = [];
    /** @type {File[]} */
    const rejected = [];
    for (const file of incoming) {
      if (fileMatchesAccept(file, acceptTokens)) accepted.push(file);
      else rejected.push(file);
    }
    return { accepted, rejected };
  }

  function reportRejected(rejected) {
    if (!rejected.length) return;
    const message =
      rejected.length === 1
        ? `"${rejected[0].name}" is not an accepted file type.`
        : `${rejected.length} files were not an accepted type.`;
    onError?.({
      fileEl,
      message,
      files: rejected,
      reason: "accept",
    });
  }

  function trimToMax(candidateFiles) {
    if (!max || !Number.isFinite(max) || max <= 0) return candidateFiles;
    if (candidateFiles.length <= max) return candidateFiles;

    onError?.({
      fileEl,
      message: `You can add at most ${max} file${max === 1 ? "" : "s"}.`,
      files: candidateFiles,
      reason: "max",
    });
    return candidateFiles.slice(0, max);
  }

  function destroyListBindings() {
    listCleanups.forEach((cleanup) => cleanup());
    listCleanups = [];
  }

  function commitFiles(nextFiles) {
    const hadFiles = files.length > 0;
    files = nextFiles;
    syncInputFiles(input, files);
    renderList();

    if (!files.length) {
      if (hadFiles) onClear?.({ fileEl });
      onFiles?.({ fileEl, files });
      return;
    }

    onFiles?.({ fileEl, files });
  }

  function addFiles(incoming) {
    if (!incoming.length) return;

    const { accepted, rejected } = partitionByAccept(incoming);
    reportRejected(rejected);
    if (!accepted.length) return;

    const next = isMultiple ? [...files, ...accepted] : accepted.slice(0, 1);
    commitFiles(trimToMax(next));
  }

  function removeFile(index) {
    const file = files[index];
    onRemove?.({
      fileEl,
      index,
      filename: file?.name,
      file,
    });
    commitFiles(files.filter((_, fileIndex) => fileIndex !== index));
  }

  async function runDownload(index) {
    const file = files[index];
    if (!file) return null;
    const result = await downloadFile({
      filename: file.name,
      content: file,
      mimeType: file.type || DEFAULT_MIME_TYPE,
    });
    onDownload?.({
      fileEl,
      index,
      filename: file.name,
      size: result.size,
    });
    return result;
  }

  function openPicker() {
    input.value = "";
    input.click();
  }

  function renderList() {
    if (!list) return;
    destroyListBindings();

    if (!files.length) {
      setHidden(list, true);
      list.replaceChildren();
      return;
    }

    setHidden(list, false);
    list.replaceChildren();

    files.forEach((file, index) => {
      const li = document.createElement("li");
      const itemEl = document.createElement("div");
      itemEl.className = "file-item";

      const main = ensureMain(itemEl, {
        nameAction: hostNameAction,
        filename: file.name,
      });
      main.dataset.fileName = file.name;
      if (file.type) main.dataset.fileMime = file.type;
      applyVisibilityClasses(itemEl, {
        extVisibility: hostExtVisibility,
        sizeVisibility: hostSizeVisibility,
      });
      updateItemMeta(itemEl, {
        filename: file.name,
        byteLength: file.size,
      });

      const downloadBtn = ensureSegment(
        itemEl,
        "download",
        file.name,
        hostDownload
      );
      const uploadBtn = ensureSegment(itemEl, "upload", file.name, hostUpload);
      const removeBtn = ensureSegment(itemEl, "remove", file.name, hostRemove);

      /** @type {HTMLInputElement | null} */
      let rowInput = null;
      if (hostUpload) {
        rowInput = document.createElement("input");
        rowInput.type = "file";
        rowInput.className = "file-item-input";
        rowInput.hidden = true;
        if (acceptTypes) rowInput.accept = acceptTypes;
        rowInput.multiple = false;
        li.append(rowInput);

        const onRowChange = () => {
          const incoming = [...(rowInput?.files ?? [])];
          if (!incoming.length) return;
          const { accepted, rejected } = partitionByAccept(incoming);
          reportRejected(rejected);
          if (!accepted.length) return;
          const replacement = accepted[0];
          const next = [...files];
          next[index] = replacement;
          onUpload?.({
            fileEl,
            itemEl,
            index,
            file: replacement,
            filename: replacement.name,
          });
          commitFiles(next);
        };
        rowInput.addEventListener("change", onRowChange);
        listCleanups.push(() =>
          rowInput?.removeEventListener("change", onRowChange)
        );
      }

      if (hostNameAction === "download") {
        listCleanups.push(bindClick(main, () => {
          void runDownload(index);
        }));
      } else if (hostNameAction === "upload" && rowInput) {
        listCleanups.push(
          bindClick(main, () => {
            rowInput.value = "";
            rowInput.click();
          })
        );
      } else if (hostNameAction === "remove") {
        listCleanups.push(bindClick(main, () => removeFile(index)));
      } else if (hostNameAction === "custom") {
        listCleanups.push(
          bindClick(main, () => {
            onNameAction?.({
              fileEl,
              itemEl,
              index,
              filename: file.name,
              file,
            });
          })
        );
      }

      if (downloadBtn) {
        listCleanups.push(
          bindClick(downloadBtn, () => {
            void runDownload(index);
          })
        );
      }
      if (uploadBtn && rowInput) {
        listCleanups.push(
          bindClick(uploadBtn, () => {
            rowInput.value = "";
            rowInput.click();
          })
        );
      }
      if (removeBtn) {
        listCleanups.push(bindClick(removeBtn, () => removeFile(index)));
      }

      li.append(itemEl);
      list.append(li);
    });
  }

  function onPromptClick() {
    openPicker();
  }

  function onInputChange() {
    const incoming = [...input.files];
    if (!incoming.length) return;
    addFiles(incoming);
  }

  function onDragEnter(event) {
    event.preventDefault();
    dragDepth += 1;
    setDragover(true);
  }

  function onDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event) {
    event.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      setDragover(false);
    }
  }

  function onDrop(event) {
    event.preventDefault();
    dragDepth = 0;
    setDragover(false);

    const incoming = [...(event.dataTransfer?.files ?? [])];
    if (!incoming.length) return;
    addFiles(incoming);
  }

  prompt.addEventListener("click", onPromptClick);
  input.addEventListener("change", onInputChange);
  fileEl.addEventListener("dragenter", onDragEnter);
  fileEl.addEventListener("dragover", onDragOver);
  fileEl.addEventListener("dragleave", onDragLeave);
  fileEl.addEventListener("drop", onDrop);

  renderList();

  return {
    openPicker,
    clear: () => commitFiles([]),
    setFiles: (nextFiles) => {
      const incoming = Array.isArray(nextFiles) ? nextFiles.filter(Boolean) : [];
      const { accepted, rejected } = partitionByAccept(incoming);
      reportRejected(rejected);
      if (!accepted.length) return;
      commitFiles(isMultiple ? trimToMax(accepted) : accepted.slice(0, 1));
    },
    getFiles: () => [...files],
    download: (index = 0) => runDownload(index),
    remove: (index = 0) => removeFile(index),
    destroy: () => {
      destroyListBindings();
      prompt.removeEventListener("click", onPromptClick);
      input.removeEventListener("change", onInputChange);
      fileEl.removeEventListener("dragenter", onDragEnter);
      fileEl.removeEventListener("dragover", onDragOver);
      fileEl.removeEventListener("dragleave", onDragLeave);
      fileEl.removeEventListener("drop", onDrop);
      dragDepth = 0;
      setDragover(false);
    },
  };
}

function isFileDragEvent(event) {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return [...types].includes("Files");
}

/**
 * Fullscreen page drop overlay (`.file.file--fullscreen`).
 * Default: activate when a file drag enters the document, fire `onFiles` on drop,
 * and hide again (no persistent list in the overlay).
 *
 * @param {HTMLElement} fileEl
 * @param {object} [options]
 */
function initFileFullscreen(fileEl, options = {}) {
  const input = fileEl.querySelector(".file-input");
  const prompt = fileEl.querySelector(".file-prompt");
  if (!prompt) return null;

  const { onFiles, onError } = options;

  const acceptTypes = options.accept ?? fileEl.dataset.fileAccept ?? "";
  const acceptTokens = parseAcceptTokens(acceptTypes);
  const acceptFilterMode = resolveAcceptFilter(
    typeof options.acceptFilter === "string"
      ? options.acceptFilter
      : fileEl.dataset.fileAcceptFilter
  );
  const isMultiple =
    options.multiple ?? parseBooleanAttr(fileEl.dataset.fileMultiple) ?? false;
  const max =
    options.maxFiles ??
    (fileEl.dataset.fileMax ? Number(fileEl.dataset.fileMax) : undefined);
  const activateOnDrag =
    options.fullscreenActivateOnDrag ??
    parseBooleanAttr(fileEl.dataset.fileFullscreenActivateOnDrag) ??
    true;

  if (input) {
    if (acceptTypes) input.accept = acceptTypes;
    input.multiple = isMultiple;
  }
  if (acceptFilterMode === "soft") {
    fileEl.dataset.fileAcceptFilter = "soft";
  } else {
    delete fileEl.dataset.fileAcceptFilter;
  }

  const constraintsLabel = formatConstraintsLabel(acceptTypes, isMultiple, max);
  const text = prompt.querySelector(".file-prompt-text") ?? prompt;
  let meta = text.querySelector(".file-prompt-meta");
  if (constraintsLabel) {
    if (!meta) {
      meta = document.createElement("span");
      meta.className = "file-prompt-meta";
      text.append(meta);
    }
    meta.textContent = constraintsLabel;
    setHidden(meta, false);
  } else if (meta) {
    meta.textContent = "";
    setHidden(meta, true);
  }

  let active = false;
  let docDragDepth = 0;
  let overlayDragDepth = 0;

  function setDragover(on) {
    fileEl.classList.toggle("is-dragover", on);
  }

  function setActive(next, { fromDrag = false } = {}) {
    const want = Boolean(next);
    if (want === active) {
      if (want) setDragover(fromDrag || overlayDragDepth > 0);
      return;
    }
    active = want;
    fileEl.classList.toggle("is-active", active);
    setHidden(fileEl, !active);
    if (!active) {
      docDragDepth = 0;
      overlayDragDepth = 0;
      setDragover(false);
    } else if (fromDrag) {
      setDragover(true);
    }
  }

  function partitionByAccept(incoming) {
    if (!acceptTokens.length || acceptFilterMode === "soft") {
      return { accepted: incoming, rejected: [] };
    }
    /** @type {File[]} */
    const accepted = [];
    /** @type {File[]} */
    const rejected = [];
    for (const file of incoming) {
      if (fileMatchesAccept(file, acceptTokens)) accepted.push(file);
      else rejected.push(file);
    }
    return { accepted, rejected };
  }

  function reportRejected(rejected) {
    if (!rejected.length) return;
    const message =
      rejected.length === 1
        ? `"${rejected[0].name}" is not an accepted file type.`
        : `${rejected.length} files were not an accepted type.`;
    onError?.({
      fileEl,
      message,
      files: rejected,
      reason: "accept",
    });
  }

  function trimToMax(candidateFiles) {
    if (!max || !Number.isFinite(max) || max <= 0) return candidateFiles;
    if (candidateFiles.length <= max) return candidateFiles;

    onError?.({
      fileEl,
      message: `You can add at most ${max} file${max === 1 ? "" : "s"}.`,
      files: candidateFiles,
      reason: "max",
    });
    return candidateFiles.slice(0, max);
  }

  /**
   * @param {File[]} incoming
   */
  function acceptIncoming(incoming) {
    if (!incoming.length) return;
    const { accepted, rejected } = partitionByAccept(incoming);
    reportRejected(rejected);
    if (!accepted.length) return;

    const next = isMultiple
      ? trimToMax(accepted)
      : accepted.slice(0, 1);
    onFiles?.({ fileEl, files: next });
  }

  function openPicker() {
    if (!input) return;
    input.value = "";
    input.click();
  }

  function onPromptClick() {
    openPicker();
  }

  function onInputChange() {
    if (!input) return;
    const incoming = [...input.files];
    if (!incoming.length) return;
    acceptIncoming(incoming);
    if (activateOnDrag) setActive(false);
  }

  function onOverlayDragEnter(event) {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    overlayDragDepth += 1;
    setDragover(true);
  }

  function onOverlayDragOver(event) {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onOverlayDragLeave(event) {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    overlayDragDepth -= 1;
    if (overlayDragDepth <= 0) {
      overlayDragDepth = 0;
      setDragover(false);
      if (activateOnDrag) setActive(false);
    }
  }

  function onOverlayDrop(event) {
    event.preventDefault();
    overlayDragDepth = 0;
    docDragDepth = 0;
    setDragover(false);

    const incoming = [...(event.dataTransfer?.files ?? [])];
    acceptIncoming(incoming);
    if (activateOnDrag) setActive(false);
  }

  function onDocumentDragEnter(event) {
    if (!activateOnDrag || !isFileDragEvent(event)) return;
    event.preventDefault();
    docDragDepth += 1;
    setActive(true, { fromDrag: true });
  }

  function onDocumentDragOver(event) {
    if (!activateOnDrag || !isFileDragEvent(event)) return;
    event.preventDefault();
  }

  function onDocumentDragLeave(event) {
    if (!activateOnDrag || !isFileDragEvent(event)) return;
    docDragDepth -= 1;
    if (docDragDepth <= 0) {
      docDragDepth = 0;
      // Leave to the overlay itself — keep showing; leave the window — hide.
      if (!fileEl.contains(/** @type {Node | null} */ (event.relatedTarget))) {
        setActive(false);
      }
    }
  }

  function onDocumentDrop(event) {
    if (!activateOnDrag) return;
    // Overlay drop handler owns accepted drops; reset counters if drop lands elsewhere.
    if (!fileEl.contains(/** @type {Node | null} */ (event.target))) {
      docDragDepth = 0;
      setActive(false);
    }
  }

  // Start hidden when drag-activation is on; otherwise leave author visibility as-is.
  if (activateOnDrag) {
    setActive(false);
  } else {
    active = !fileEl.hidden && !fileEl.classList.contains("hidden");
    fileEl.classList.toggle("is-active", active);
  }

  prompt.addEventListener("click", onPromptClick);
  input?.addEventListener("change", onInputChange);
  fileEl.addEventListener("dragenter", onOverlayDragEnter);
  fileEl.addEventListener("dragover", onOverlayDragOver);
  fileEl.addEventListener("dragleave", onOverlayDragLeave);
  fileEl.addEventListener("drop", onOverlayDrop);

  if (activateOnDrag) {
    document.addEventListener("dragenter", onDocumentDragEnter);
    document.addEventListener("dragover", onDocumentDragOver);
    document.addEventListener("dragleave", onDocumentDragLeave);
    document.addEventListener("drop", onDocumentDrop);
  }

  return {
    openPicker,
    show: () => setActive(true),
    hide: () => setActive(false),
    setActive: (next) => setActive(next),
    isActive: () => active,
    destroy: () => {
      prompt.removeEventListener("click", onPromptClick);
      input?.removeEventListener("change", onInputChange);
      fileEl.removeEventListener("dragenter", onOverlayDragEnter);
      fileEl.removeEventListener("dragover", onOverlayDragOver);
      fileEl.removeEventListener("dragleave", onOverlayDragLeave);
      fileEl.removeEventListener("drop", onOverlayDrop);
      if (activateOnDrag) {
        document.removeEventListener("dragenter", onDocumentDragEnter);
        document.removeEventListener("dragover", onDocumentDragOver);
        document.removeEventListener("dragleave", onDocumentDragLeave);
        document.removeEventListener("drop", onDocumentDrop);
      }
      docDragDepth = 0;
      overlayDragDepth = 0;
      setDragover(false);
    },
  };
}

/** Wire every `.file` block in `root`. */
export function initFiles(root = document) {
  const instances = [];
  root.querySelectorAll(".file").forEach((el) => {
    const instance = initFile(el);
    if (instance) instances.push(instance);
  });
  return instances;
}
