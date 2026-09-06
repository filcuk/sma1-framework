import { parseBooleanAttr, setHidden } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";

/**
 * Segmented file control (combo-style). Rows expose an optional name segment plus
 * download / upload / remove action segments.
 *
 * Markup:
 *   <div class="file" data-file-download data-file-ext-visibility="hover"
 *     data-file-size-visibility="hover" data-file-name-action="none">
 *     <ul class="file-list">
 *       <li>
 *         <div class="file-item">
 *           <div class="btn file-item-main" data-file-name="notes.txt">
 *             <span class="file-item-name">notes</span>
 *             <span class="file-item-ext">.txt</span>
 *             <span class="file-item-meta"></span>
 *           </div>
 *           <button type="button" class="btn file-item-download" aria-label="Download notes.txt">
 *             <span data-icon="download" data-icon-class="btn-icon-svg"></span>
 *           </button>
 *         </div>
 *       </li>
 *     </ul>
 *   </div>
 *
 * Segment defaults: download on, remove off, upload off.
 * Name action: none | download | upload | remove | custom (via onNameAction).
 * Ext / size visibility: hover | always | never (independent).
 *
 * data-file-name / data-file-mime — per-item filename and MIME
 * data-file-accept / data-file-accept-filter — upload accept (strict | soft)
 * data-file-drop-active — when upload is on, treat the row as a drop target
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
 * @param {HTMLElement} fileEl
 * @param {{
 *   filename?: string,
 *   mimeType?: string,
 *   content?: string | Blob | ArrayBuffer,
 *   getContent?: () => string | Blob | ArrayBuffer | Promise<string | Blob | ArrayBuffer>,
 *   files?: Array<Record<string, unknown>>,
 *   download?: boolean,
 *   remove?: boolean,
 *   upload?: boolean,
 *   nameAction?: string,
 *   onNameAction?: (detail: object) => void,
 *   extVisibility?: string,
 *   sizeVisibility?: string,
 *   accept?: string,
 *   acceptFilter?: string,
 *   dropActive?: boolean,
 *   onDownload?: (detail: object) => void,
 *   onUpload?: (detail: object) => void,
 *   onRemove?: (detail: object) => void,
 *   onError?: (detail: object) => void,
 * }} [options]
 */
export function initFile(fileEl, options = {}) {
  if (!fileEl) return null;

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
      input = itemEl.querySelector(".file-item-input");
      if (!input) {
        input = document.createElement("input");
        input.type = "file";
        input.className = "file-item-input";
        input.hidden = true;
        itemEl.append(input);
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

/** Wire every `.file` block in `root`. */
export function initFiles(root = document) {
  const instances = [];
  root.querySelectorAll(".file").forEach((fileEl) => {
    const instance = initFile(fileEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
