/**
 * Checkerboard image preview — SVG markup, image URLs, or Blob/File.
 *
 * Markup:
 *   <div class="image-preview" aria-live="polite"
 *     data-image-preview-pixelated>
 *     <p class="image-preview__empty">No image</p>
 *   </div>
 *
 * data-image-preview-pixelated — crisp nearest-neighbour scaling for media
 *
 * Content is set via the instance API (`setSvg`, `setSrc`, `setBlob`, `clear`).
 */

import { setHidden } from "../utils/dom.js";

const SVG_PARSER = new DOMParser();

/**
 * @param {HTMLElement} el
 * @returns {HTMLElement | null}
 */
function getEmptyEl(el) {
  return el.querySelector(".image-preview__empty");
}

/**
 * @param {HTMLElement} el
 */
function removeMedia(el) {
  for (const node of [...el.children]) {
    if (node.classList.contains("image-preview__empty")) continue;
    node.remove();
  }
}

/**
 * @param {string} markup
 * @returns {SVGSVGElement | null}
 */
function parseSvgMarkup(markup) {
  const doc = SVG_PARSER.parseFromString(String(markup ?? ""), "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const svg = doc.documentElement;
  return svg instanceof SVGSVGElement ? svg : null;
}

/**
 * @param {HTMLElement} el
 * @param {object} [options]
 */
export function initImagePreview(el, options = {}) {
  if (!(el instanceof HTMLElement)) return null;
  if (!el.classList.contains("image-preview")) return null;
  if (el.dataset.imagePreviewInit !== undefined) return null;

  el.dataset.imagePreviewInit = "";

  const emptyEl = getEmptyEl(el);
  /** @type {string | null} */
  let objectUrl = null;
  /** @type {"svg" | "img" | null} */
  let contentType = null;

  function revokeObjectUrl() {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function showEmpty(empty) {
    if (emptyEl) setHidden(emptyEl, !empty);
  }

  function clearMedia() {
    revokeObjectUrl();
    removeMedia(el);
    contentType = null;
    showEmpty(true);
  }

  // Initial state: empty when there is no media child yet
  const hasMedia = [...el.children].some(
    (node) => !node.classList.contains("image-preview__empty")
  );
  if (!hasMedia) {
    showEmpty(true);
    contentType = null;
  } else {
    showEmpty(false);
    contentType = el.querySelector("svg") ? "svg" : "img";
  }

  if (options.pixelated === true) {
    el.dataset.imagePreviewPixelated = "";
  } else if (options.pixelated === false) {
    delete el.dataset.imagePreviewPixelated;
  }

  return {
    /** @returns {"svg" | "img" | null} */
    getContentType() {
      return contentType;
    },

    /**
     * Inject inline SVG markup (SMIL animation is preserved).
     * @param {string} markup
     * @returns {boolean}
     */
    setSvg(markup) {
      const svg = parseSvgMarkup(markup);
      if (!svg) return false;
      revokeObjectUrl();
      removeMedia(el);
      el.append(document.importNode(svg, true));
      contentType = "svg";
      showEmpty(false);
      return true;
    },

    /**
     * Show an image from a URL (GIF / APNG / WebP animate in the browser).
     * @param {string} url
     * @param {{ alt?: string }} [imgOptions]
     */
    setSrc(url, imgOptions = {}) {
      if (!url) {
        clearMedia();
        return;
      }
      revokeObjectUrl();
      removeMedia(el);
      const img = document.createElement("img");
      img.className = "image-preview__media";
      img.src = url;
      img.alt = imgOptions.alt ?? "";
      img.decoding = "async";
      el.append(img);
      contentType = "img";
      showEmpty(false);
    },

    /**
     * Show a Blob or File via an object URL (revoked on replace / clear / destroy).
     * @param {Blob} blob
     * @param {{ alt?: string }} [imgOptions]
     */
    setBlob(blob, imgOptions = {}) {
      if (!(blob instanceof Blob)) {
        clearMedia();
        return;
      }
      revokeObjectUrl();
      removeMedia(el);
      objectUrl = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.className = "image-preview__media";
      img.src = objectUrl;
      img.alt = imgOptions.alt ?? "";
      img.decoding = "async";
      el.append(img);
      contentType = "img";
      showEmpty(false);
    },

    clear() {
      clearMedia();
    },

    destroy() {
      clearMedia();
      delete el.dataset.imagePreviewInit;
    },
  };
}

/** Wire every `.image-preview` in `root`. */
export function initImagePreviews(root = document) {
  const instances = [];
  for (const el of root.querySelectorAll(".image-preview")) {
    if (!(el instanceof HTMLElement)) continue;
    const instance = initImagePreview(el);
    if (instance) instances.push(instance);
  }
  return instances;
}
