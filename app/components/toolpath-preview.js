/**
 * Interactive Three.js G-code toolpath preview.
 *
 * The host intentionally reuses the `.model-preview` surface styles:
 *   <div class="model-preview toolpath-preview"
 *     data-toolpath-preview-segments
 *     data-toolpath-preview-layers
 *     data-toolpath-preview-current-layer
 *     data-toolpath-preview-meta="hover"
 *     data-toolpath-preview-meta-extra="PETG"
 *     data-toolpath-preview-maximize
 *     data-toolpath-preview-home
 *     data-toolpath-preview-layer-slider
 *     data-toolpath-preview-travel-toggle
 *     data-toolpath-preview-travels
 *     data-toolpath-preview-actions="hover"
 *     aria-label="G-code toolpath">
 *     <p class="model-preview__empty">No toolpath</p>
 *   </div>
 *
 * data-toolpath-preview-segments — show total segment count
 * data-toolpath-preview-layers — show total layer count
 * data-toolpath-preview-current-layer — show filtered layer as `layer K/N`
 * data-toolpath-preview-meta — when meta content is enabled: `hover` (default),
 *   `always`, `not-hover`, or `never`
 * data-toolpath-preview-meta-extra — append app-specific text to the meta strip
 * data-toolpath-preview-maximize — floating fullscreen control via expandable-surface
 * data-toolpath-preview-home — floating reset-view (home) control
 * data-toolpath-preview-layer-slider — floating maximum-layer slider (default on;
 *   set `"false"` to disable). Uses the shared `.slider--hover` chrome.
 * data-toolpath-preview-travels — show non-extrusion (travel) moves; default on.
 *   Set `"false"` to hide gray paths (e.g. extrusion-only preview).
 * data-toolpath-preview-travel-toggle — floating toggle for travel moves (default on;
 *   set `"false"` to hide). Pair with `travels="false"` to start hidden but let the
 *   user re-enable, or hide both for a permanent extrusion-only view.
 * data-toolpath-preview-expand-on-click — toggle maximise when clicking the canvas host
 * data-toolpath-preview-actions — hover control visibility: `hover` (default),
 *   `always`, or `never`
 *
 * Call `initExpandableSurfaces()` after init when maximise attrs are used.
 *
 * API:
 *   const preview = initToolpathPreview(element);
 *   preview.setToolpath({ segments, layerCount, bounds, warnings });
 *   preview.setMaxLayer(3);
 *   preview.setTravels(false);
 *   preview.resetView();
 *   preview.setMetaExtra("PETG · 0.4 mm");
 *   preview.clear();
 */

import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { APP_CONFIG } from "../config.js";
import { parseBooleanAttr, setHidden, prefersReducedMotion } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";
import { createOrbitHomeAnim, tickOrbitHomeAnim } from "../utils/orbit-home.js";
import { initSlider } from "./slider.js";
import { initToggleButton } from "./toggle-button.js";
import { UNSUPPORTED_GEOMETRY_WARNING } from "./gcode-toolpath.js";

const DEFAULT_ARIA_LABEL = "G-code toolpath preview";
const MAX_PIXEL_RATIO = 2;
const EPSILON = 1e-5;

/**
 * @param {string | null | undefined} value
 * @returns {"hover" | "always" | "not-hover" | "never"}
 */
function resolveMetaVisibility(value) {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    trimmed === "always" ||
    trimmed === "never" ||
    trimmed === "hover" ||
    trimmed === "not-hover"
  ) {
    return trimmed;
  }
  return "hover";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function resolveMetaExtra(value) {
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(" · ");
  }
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | null | undefined} value
 * @returns {"hover" | "always" | "never"}
 */
function resolveActionsVisibility(value) {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (trimmed === "always" || trimmed === "never" || trimmed === "hover") {
    return trimmed;
  }
  return "hover";
}

/**
 * Layer slider is on by default; set `data-toolpath-preview-layer-slider="false"`
 * (or `layerSlider: false`) to disable.
 *
 * @param {HTMLElement} el
 * @param {{ layerSlider?: boolean }} options
 * @returns {boolean}
 */
function resolveLayerSliderEnabled(el, options) {
  if (typeof options.layerSlider === "boolean") return options.layerSlider;
  const raw = el.getAttribute("data-toolpath-preview-layer-slider");
  if (raw === null) return true;
  if (raw === "false") return false;
  return parseBooleanAttr(raw) ?? true;
}

/**
 * Travel-move toggle is on by default; set
 * `data-toolpath-preview-travel-toggle="false"` to hide it.
 *
 * @param {HTMLElement} el
 * @param {{ travelToggle?: boolean }} options
 * @returns {boolean}
 */
function resolveTravelToggleEnabled(el, options) {
  if (typeof options.travelToggle === "boolean") return options.travelToggle;
  const raw = el.getAttribute("data-toolpath-preview-travel-toggle");
  if (raw === null) return true;
  if (raw === "false") return false;
  return parseBooleanAttr(raw) ?? true;
}

/**
 * Travel (non-extrusion) paths are shown by default; set
 * `data-toolpath-preview-travels="false"` to start hidden.
 *
 * @param {HTMLElement} el
 * @param {{ travels?: boolean }} options
 * @returns {boolean}
 */
function resolveTravelsVisible(el, options) {
  if (typeof options.travels === "boolean") return options.travels;
  const raw = el.getAttribute("data-toolpath-preview-travels");
  if (raw === null) return true;
  if (raw === "false") return false;
  return parseBooleanAttr(raw) ?? true;
}

/**
 * Map maximise / home / layer-slider / travel-toggle options onto
 * expandable-surface and surface-actions chrome.
 * Call `initExpandableSurfaces()` after init (or on the page) to activate maximise.
 *
 * @param {HTMLElement} el
 * @param {{
 *   maximize?: boolean,
 *   expandOnClick?: boolean,
 *   home?: boolean,
 *   layerSlider?: boolean,
 *   travelToggle?: boolean,
 *   travels?: boolean,
 *   actions?: string,
 * }} options
 */
function syncExpandableAttrs(el, options) {
  const maximize =
    typeof options.maximize === "boolean"
      ? options.maximize
      : el.hasAttribute("data-toolpath-preview-maximize");
  const expandOnClick =
    typeof options.expandOnClick === "boolean"
      ? options.expandOnClick
      : el.hasAttribute("data-toolpath-preview-expand-on-click");
  const home =
    typeof options.home === "boolean"
      ? options.home
      : el.hasAttribute("data-toolpath-preview-home");
  const layerSlider = resolveLayerSliderEnabled(el, options);
  const travelToggle = resolveTravelToggleEnabled(el, options);
  const travels = resolveTravelsVisible(el, options);
  const actionsVisibility = resolveActionsVisibility(
    typeof options.actions === "string"
      ? options.actions
      : el.dataset.toolpathPreviewActions
  );

  if (maximize) el.setAttribute("data-toolpath-preview-maximize", "");
  else el.removeAttribute("data-toolpath-preview-maximize");

  if (expandOnClick) el.setAttribute("data-toolpath-preview-expand-on-click", "");
  else el.removeAttribute("data-toolpath-preview-expand-on-click");

  if (home) el.setAttribute("data-toolpath-preview-home", "");
  else el.removeAttribute("data-toolpath-preview-home");

  if (layerSlider) el.setAttribute("data-toolpath-preview-layer-slider", "");
  else el.setAttribute("data-toolpath-preview-layer-slider", "false");

  if (travelToggle) el.setAttribute("data-toolpath-preview-travel-toggle", "");
  else el.setAttribute("data-toolpath-preview-travel-toggle", "false");

  if (travels) el.setAttribute("data-toolpath-preview-travels", "");
  else el.setAttribute("data-toolpath-preview-travels", "false");

  if (!maximize && !expandOnClick && !home && !layerSlider && !travelToggle) {
    el.removeAttribute("data-expandable-surface-click");
    el.removeAttribute("data-expandable-surface-control");
    delete el.dataset.toolpathPreviewActions;
    return {
      maximize: false,
      expandOnClick: false,
      home: false,
      layerSlider: false,
      travelToggle: false,
      travels,
      actionsVisibility,
    };
  }

  if (maximize || expandOnClick) {
    el.setAttribute("data-expandable-surface", "");
    if (!el.dataset.expandableSurfaceLabel?.trim()) {
      el.dataset.expandableSurfaceLabel =
        el.getAttribute("aria-label") || DEFAULT_ARIA_LABEL;
    }

    if (expandOnClick) el.setAttribute("data-expandable-surface-click", "");
    else el.removeAttribute("data-expandable-surface-click");

    if (maximize) el.removeAttribute("data-expandable-surface-control");
    else el.setAttribute("data-expandable-surface-control", "false");
  } else {
    el.removeAttribute("data-expandable-surface-click");
    el.removeAttribute("data-expandable-surface-control");
  }

  if (maximize || home || layerSlider || travelToggle) {
    let actionsHost = el.querySelector(":scope > .surface-actions");
    if (!actionsHost) {
      actionsHost = document.createElement("div");
      actionsHost.className = "surface-actions";
      el.append(actionsHost);
    }
    el.dataset.toolpathPreviewActions = actionsVisibility;
  } else {
    delete el.dataset.toolpathPreviewActions;
  }

  return {
    maximize,
    expandOnClick,
    home,
    layerSlider,
    travelToggle,
    travels,
    actionsVisibility,
  };
}

function readCssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function readSegments(toolpath) {
  if (!toolpath || typeof toolpath !== "object" || !Array.isArray(toolpath.segments)) {
    throw new TypeError("toolpath.segments must be an array");
  }

  return toolpath.segments.map((segment) => {
    if (!segment || typeof segment !== "object") {
      throw new TypeError("toolpath contains an invalid segment");
    }
    const values = ["x1", "y1", "z1", "x2", "y2", "z2"].map((key) =>
      Number(segment[key])
    );
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError("toolpath contains a segment with invalid coordinates");
    }
    return {
      x1: values[0],
      y1: values[1],
      z1: values[2],
      x2: values[3],
      y2: values[4],
      z2: values[5],
      layer: Number.isFinite(Number(segment.layer))
        ? Math.max(0, Math.floor(Number(segment.layer)))
        : 0,
      extruding: Boolean(segment.extruding),
    };
  });
}

function addSegmentPositions(target, segment) {
  if (
    Math.abs(segment.x2 - segment.x1) <= EPSILON &&
    Math.abs(segment.y2 - segment.y1) <= EPSILON &&
    Math.abs(segment.z2 - segment.z1) <= EPSILON
  ) {
    return;
  }
  target.push(
    segment.x1,
    segment.y1,
    segment.z1,
    segment.x2,
    segment.y2,
    segment.z2
  );
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Object3D} object
 * @returns {{
 *   position: THREE.Vector3,
 *   target: THREE.Vector3,
 *   near: number,
 *   far: number,
 *   minDistance: number,
 *   maxDistance: number,
 * } | null}
 */
function computeFitPose(camera, object) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) return null;

  const distance =
    (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
    1.35;
  return {
    position: new THREE.Vector3(
      center.x + distance * 0.9,
      center.y + distance * 0.75,
      center.z + distance * 0.9
    ),
    target: center,
    near: Math.max(maxDimension / 1000, 0.01),
    far: Math.max(maxDimension * 20, 100),
    minDistance: Math.max(maxDimension * 0.1, 0.01),
    maxDistance: Math.max(maxDimension * 20, 100),
  };
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {OrbitControls} controls
 * @param {ReturnType<typeof computeFitPose>} pose
 */
function applyFitPose(camera, controls, pose) {
  if (!pose) return;
  camera.near = pose.near;
  camera.far = pose.far;
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  controls.target.copy(pose.target);
  controls.minDistance = pose.minDistance;
  controls.maxDistance = pose.maxDistance;
  controls.update();
  camera.updateProjectionMatrix();
}

function fitCameraToObject(camera, controls, object) {
  applyFitPose(camera, controls, computeFitPose(camera, object));
}

/**
 * @param {HTMLElement} previewEl
 * @param {{
 *   segments?: boolean,
 *   layers?: boolean,
 *   currentLayer?: boolean,
 *   meta?: string,
 *   metaExtra?: string | string[],
 *   maximize?: boolean,
 *   expandOnClick?: boolean,
 *   home?: boolean,
 *   layerSlider?: boolean,
 *   travelToggle?: boolean,
 *   travels?: boolean,
 *   actions?: string,
 * }} [options]
 * @returns {{
 *   setToolpath: (toolpath: { segments: ArrayLike<unknown>, layerCount?: number }) => void,
 *   setMaxLayer: (layer: number | null) => void,
 *   setTravels: (visible: boolean) => void,
 *   getTravels: () => boolean,
 *   resetView: () => void,
 *   setMetaExtra: (text: string | string[] | null | undefined) => void,
 *   clear: () => void,
 *   destroy: () => void,
 * } | null}
 */
export function initToolpathPreview(previewEl, options = {}) {
  if (!(previewEl instanceof HTMLElement)) return null;
  if (!previewEl.classList.contains("toolpath-preview")) return null;
  if (previewEl.dataset.toolpathPreviewInit !== undefined) return null;

  previewEl.dataset.toolpathPreviewInit = "";
  const emptyEl = previewEl.querySelector(
    ".toolpath-preview__empty, .model-preview__empty"
  );
  const ariaLabel =
    previewEl.getAttribute("aria-label") || DEFAULT_ARIA_LABEL;

  const showSegments =
    typeof options.segments === "boolean"
      ? options.segments
      : previewEl.hasAttribute("data-toolpath-preview-segments");
  const showLayers =
    typeof options.layers === "boolean"
      ? options.layers
      : previewEl.hasAttribute("data-toolpath-preview-layers");
  const showCurrentLayer =
    typeof options.currentLayer === "boolean"
      ? options.currentLayer
      : previewEl.hasAttribute("data-toolpath-preview-current-layer");
  const fixedMetaContent = showSegments || showLayers || showCurrentLayer;
  const configuredMetaVisibility = resolveMetaVisibility(
    typeof options.meta === "string"
      ? options.meta
      : previewEl.dataset.toolpathPreviewMeta
  );
  let metaExtra = resolveMetaExtra(
    options.metaExtra !== undefined
      ? options.metaExtra
      : previewEl.dataset.toolpathPreviewMetaExtra
  );
  let hasMetaContent = fixedMetaContent || metaExtra !== "";
  let metaVisibility = hasMetaContent ? configuredMetaVisibility : "never";
  /** Short geometry warning shown in the meta strip (e.g. unsupported arcs). */
  let geometryWarning = "";

  const expandState = syncExpandableAttrs(previewEl, options);
  const showHome = expandState.home;
  const showLayerSlider = expandState.layerSlider;
  const showTravelToggle = expandState.travelToggle;
  let showTravels = expandState.travels;

  if (showSegments) previewEl.setAttribute("data-toolpath-preview-segments", "");
  else previewEl.removeAttribute("data-toolpath-preview-segments");
  if (showLayers) previewEl.setAttribute("data-toolpath-preview-layers", "");
  else previewEl.removeAttribute("data-toolpath-preview-layers");
  if (showCurrentLayer) {
    previewEl.setAttribute("data-toolpath-preview-current-layer", "");
  } else {
    previewEl.removeAttribute("data-toolpath-preview-current-layer");
  }

  if (metaExtra) previewEl.dataset.toolpathPreviewMetaExtra = metaExtra;
  else delete previewEl.dataset.toolpathPreviewMetaExtra;

  if (hasMetaContent) {
    previewEl.dataset.toolpathPreviewMeta = metaVisibility;
  } else {
    delete previewEl.dataset.toolpathPreviewMeta;
  }

  /** @type {HTMLParagraphElement | null} */
  let metaEl = null;
  /** @type {HTMLButtonElement | null} */
  let homeBtn = null;
  /** @type {HTMLButtonElement | null} */
  let travelToggleBtn = null;
  /** @type {ReturnType<typeof initToggleButton> | null} */
  let travelToggle = null;
  /** @type {HTMLElement | null} */
  let layerSliderEl = null;
  /** @type {ReturnType<typeof initSlider> | null} */
  let layerSlider = null;
  let syncingLayerSlider = false;

  function ensureMetaEl() {
    if (!hasMetaContent || metaVisibility === "never") {
      if (metaEl) setHidden(metaEl, true);
      return null;
    }
    if (metaEl?.isConnected) return metaEl;
    metaEl = previewEl.querySelector(":scope > .toolpath-preview__meta");
    if (!(metaEl instanceof HTMLParagraphElement)) {
      metaEl = document.createElement("p");
      metaEl.className = "toolpath-preview__meta";
      previewEl.append(metaEl);
    }
    return metaEl;
  }

  function syncMetaVisibilityAttr() {
    hasMetaContent =
      fixedMetaContent || metaExtra !== "" || geometryWarning !== "";
    metaVisibility = hasMetaContent ? configuredMetaVisibility : "never";
    if (metaExtra) previewEl.dataset.toolpathPreviewMetaExtra = metaExtra;
    else delete previewEl.dataset.toolpathPreviewMetaExtra;
    if (hasMetaContent) {
      previewEl.dataset.toolpathPreviewMeta = metaVisibility;
    } else {
      delete previewEl.dataset.toolpathPreviewMeta;
    }
  }

  /**
   * @param {unknown} warnings
   */
  function resolveGeometryWarning(warnings) {
    if (!Array.isArray(warnings)) return "";
    return warnings.includes(UNSUPPORTED_GEOMETRY_WARNING)
      ? UNSUPPORTED_GEOMETRY_WARNING
      : "";
  }

  function ensureActionsHost() {
    let actionsHost = previewEl.querySelector(":scope > .surface-actions");
    if (!actionsHost) {
      actionsHost = document.createElement("div");
      actionsHost.className = "surface-actions";
      previewEl.append(actionsHost);
    }
    return actionsHost;
  }

  function syncHomeButton() {
    if (!homeBtn) return;
    homeBtn.disabled = !hasToolpath || !(extrusionLines || travelLines);
  }

  function syncTravelToggle() {
    if (!travelToggleBtn || !travelToggle) return;
    const hasTravelSegments = segments.some((segment) => !segment.extruding);
    travelToggleBtn.disabled = !hasToolpath || !hasTravelSegments;
    travelToggle.setPressed(showTravels, { emit: false });
    if (showTravels) {
      previewEl.setAttribute("data-toolpath-preview-travels", "");
    } else {
      previewEl.setAttribute("data-toolpath-preview-travels", "false");
    }
  }

  function ensureHomeButton() {
    if (!showHome) return null;
    if (homeBtn?.isConnected) return homeBtn;
    const host = ensureActionsHost();
    homeBtn = host.querySelector(".toolpath-preview__home");
    if (!(homeBtn instanceof HTMLButtonElement)) {
      homeBtn = document.createElement("button");
      homeBtn.type = "button";
      homeBtn.className = "toolpath-preview__home btn btn-slim btn-icon";
      homeBtn.dataset.tooltip = "Reset view";
      homeBtn.dataset.tooltipPosition = "top";
      homeBtn.setAttribute("aria-label", "Reset view");
      homeBtn.append(createIcon("home", { className: "btn-icon-svg" }));
      homeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        resetView();
      });
      host.append(homeBtn);
    }
    syncHomeButton();
    return homeBtn;
  }

  function ensureTravelToggle() {
    if (!showTravelToggle) return null;
    if (travelToggle && travelToggleBtn?.isConnected) return travelToggle;

    const host = ensureActionsHost();
    travelToggleBtn = host.querySelector(".toolpath-preview__travels");
    if (!(travelToggleBtn instanceof HTMLButtonElement)) {
      travelToggleBtn = document.createElement("button");
      travelToggleBtn.type = "button";
      travelToggleBtn.className =
        "toolpath-preview__travels btn btn-slim btn-icon btn-toggle";
      travelToggleBtn.dataset.toggleButton = "";
      travelToggleBtn.dataset.toggleButtonAlwaysActive = "";
      travelToggleBtn.dataset.tooltip = "Show travel moves";
      travelToggleBtn.dataset.tooltipPosition = "top";
      travelToggleBtn.setAttribute(
        "aria-pressed",
        showTravels ? "true" : "false"
      );
      host.append(travelToggleBtn);
    }

    travelToggle = initToggleButton(travelToggleBtn, {
      defaultPressed: showTravels,
      alwaysActive: true,
      ariaLabelOn: "Hide travel moves",
      ariaLabelOff: "Show travel moves",
      iconOn: "visibility",
      iconOff: "visibility-off",
      iconClass: "btn-icon-svg",
      onChange: ({ pressed, source }) => {
        if (source !== "click") return;
        showTravels = Boolean(pressed);
        renderToolpath({ fitCamera: false });
      },
    });
    travelToggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    syncTravelToggle();
    return travelToggle;
  }

  function resolvedMaxLayerValue() {
    if (layerCount <= 0) return 0;
    if (maxLayer === null) return layerCount - 1;
    return Math.min(layerCount - 1, Math.max(0, maxLayer));
  }

  /** 1-based layer number for the hover slider / meta (API `setMaxLayer` stays 0-based). */
  function resolvedLayerSliderValue() {
    return layerCount <= 0 ? 1 : resolvedMaxLayerValue() + 1;
  }

  function syncLayerSlider() {
    if (!showLayerSlider || !layerSlider || !layerSliderEl) return;
    if (!hasToolpath || layerCount <= 0) {
      setHidden(layerSliderEl, true);
      layerSlider.setDisabled(true);
      return;
    }

    setHidden(layerSliderEl, false);
    syncingLayerSlider = true;
    layerSlider.setBounds({
      min: 1,
      max: layerCount,
      value: resolvedLayerSliderValue(),
      emit: false,
    });
    syncingLayerSlider = false;
    layerSlider.setDisabled(false);
  }

  function ensureLayerSlider() {
    if (!showLayerSlider) return null;
    if (layerSlider && layerSliderEl?.isConnected) return layerSlider;

    const host = ensureActionsHost();
    layerSliderEl = host.querySelector(".toolpath-preview__layer-slider");
    if (!(layerSliderEl instanceof HTMLElement)) {
      layerSliderEl = document.createElement("div");
      layerSliderEl.className =
        "slider slider--hover toolpath-preview__layer-slider";
      layerSliderEl.dataset.sliderMin = "1";
      layerSliderEl.dataset.sliderMax = "1";
      layerSliderEl.dataset.sliderFormat = "integer";
      layerSliderEl.dataset.tooltip = "Maximum layer";
      layerSliderEl.dataset.tooltipPosition = "top";

      const row = document.createElement("div");
      row.className = "slider-row";

      const range = document.createElement("input");
      range.type = "range";
      range.className = "slider-range";
      range.setAttribute("aria-label", "Maximum layer");

      const readout = document.createElement("output");
      readout.className = "slider-readout";
      readout.setAttribute("aria-hidden", "true");
      readout.textContent = "1";

      row.append(range, readout);
      layerSliderEl.append(row);
      host.append(layerSliderEl);
    }

    layerSlider = initSlider(layerSliderEl, {
      chrome: "hover",
      format: "integer",
      min: 1,
      max: 1,
      defaultValue: 1,
      onInput: ({ value }) => {
        if (syncingLayerSlider) return;
        setMaxLayer(Math.max(0, value - 1));
      },
    });
    syncLayerSlider();
    return layerSlider;
  }

  let renderer;
  let extrusionLines = null;
  let travelLines = null;
  let hasToolpath = false;
  let destroyed = false;
  /** @type {ReturnType<typeof createOrbitHomeAnim> | null} */
  let homeAnim = null;

  function clearOrbitInertia() {
    const frozenPos = camera.position.clone();
    const frozenTarget = controls.target.clone();
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(frozenPos);
    controls.target.copy(frozenTarget);
    controls.update();
    controls.enableDamping = damping;
  }

  function syncControlsAfterHomeStep() {
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }

  function resetView() {
    if (destroyed || !(extrusionLines || travelLines)) return;
    const pose = computeFitPose(camera, group);
    if (!pose) return;

    if (prefersReducedMotion()) {
      homeAnim = null;
      applyFitPose(camera, controls, pose);
      renderer.render(scene, camera);
      return;
    }

    clearOrbitInertia();
    homeAnim = createOrbitHomeAnim(pose);
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch {
    if (emptyEl) {
      emptyEl.textContent = "3D preview is unavailable in this browser";
      setHidden(emptyEl, false);
    }
    return {
      setToolpath() {},
      setMaxLayer() {},
      setTravels() {},
      getTravels() {
        return showTravels;
      },
      resetView() {},
      setMetaExtra(text) {
        metaExtra = resolveMetaExtra(text);
        syncMetaVisibilityAttr();
      },
      clear() {},
      destroy() {
        delete previewEl.dataset.toolpathPreviewInit;
      },
    };
  }

  const canvas = renderer.domElement;
  canvas.className = "model-preview__canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", ariaLabel);
  previewEl.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(1, 2, 3);
  scene.add(ambient, hemisphere, keyLight);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.addEventListener("start", () => {
    homeAnim = null;
  });

  const group = new THREE.Group();
  // G-code coordinates are Z-up; rotate the display so Z is vertical on screen.
  group.rotation.x = -Math.PI / 2;
  scene.add(group);

  const materials = {
    extrusion: new THREE.LineBasicMaterial({
      color: readCssColor("--accent", "#0969da"),
      transparent: false,
    }),
    travel: new THREE.LineBasicMaterial({
      color: readCssColor("--muted", "#656d76"),
      transparent: true,
      opacity: 0.5,
    }),
  };
  let segments = [];
  let segmentCount = 0;
  let layerCount = 0;
  let maxLayer = null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  ensureHomeButton();
  ensureTravelToggle();
  ensureLayerSlider();

  function applyTheme() {
    const background = readCssColor("--surface", "#ffffff");
    const text = readCssColor("--text", "#1f2328");
    const surface = readCssColor("--bg", "#ffffff");
    const accent = readCssColor("--accent", "#0969da");
    const muted = readCssColor("--muted", "#656d76");
    scene.background = new THREE.Color(background);
    hemisphere.color.set(text);
    hemisphere.groundColor.set(surface);
    keyLight.color.set(text);
    materials.extrusion.color.set(accent);
    materials.travel.color.set(muted);
  }

  function resize() {
    const width = Math.max(previewEl.clientWidth, 1);
    const height = Math.max(previewEl.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function disposeLines() {
    for (const lines of [extrusionLines, travelLines]) {
      if (!lines) continue;
      group.remove(lines);
      lines.geometry.dispose();
    }
    extrusionLines = null;
    travelLines = null;
  }

  function syncMeta() {
    const meta = ensureMetaEl();
    if (!meta) return;

    /** @type {string[]} */
    const parts = [];
    if (hasToolpath) {
      if (showSegments) {
        parts.push(`${segmentCount.toLocaleString()} segments`);
      }
      if (showLayers) {
        parts.push(`${layerCount.toLocaleString()} layers`);
      }
      if (showCurrentLayer && layerCount > 0) {
        const current =
          maxLayer === null
            ? layerCount
            : Math.min(layerCount, Math.max(0, maxLayer) + 1);
        parts.push(`layer ${current}/${layerCount}`);
      }
    }
    if (geometryWarning) parts.push(geometryWarning);
    if (metaExtra) parts.push(metaExtra);

    if (!parts.length) {
      meta.textContent = "";
      setHidden(meta, true);
      return;
    }

    meta.textContent = parts.join(" · ");
    setHidden(meta, false);
  }

  function renderToolpath({ fitCamera = true } = {}) {
    disposeLines();
    const extrusionPositions = [];
    const travelPositions = [];
    for (const segment of segments) {
      if (maxLayer !== null && segment.layer > maxLayer) continue;
      addSegmentPositions(
        segment.extruding ? extrusionPositions : travelPositions,
        segment
      );
    }

    if (extrusionPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(extrusionPositions, 3)
      );
      extrusionLines = new THREE.LineSegments(geometry, materials.extrusion);
      group.add(extrusionLines);
    }
    if (showTravels && travelPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(travelPositions, 3)
      );
      travelLines = new THREE.LineSegments(geometry, materials.travel);
      group.add(travelLines);
    }

    const hasVisibleLines = Boolean(extrusionLines || travelLines);
    if (hasVisibleLines) {
      if (fitCamera) {
        homeAnim = null;
        fitCameraToObject(camera, controls, group);
      }
      if (emptyEl) setHidden(emptyEl, true);
    } else if (emptyEl) {
      setHidden(emptyEl, !hasToolpath);
    }
    syncHomeButton();
    syncTravelToggle();
    syncLayerSlider();
    syncMeta();
    renderer.render(scene, camera);
  }

  function setToolpath(toolpath) {
    segments = readSegments(toolpath);
    segmentCount = segments.length;
    const reportedLayers = Number(toolpath?.layerCount);
    layerCount = Number.isFinite(reportedLayers)
      ? Math.max(0, Math.floor(reportedLayers))
      : segments.length
        ? Math.max(...segments.map((segment) => segment.layer)) + 1
        : 0;
    hasToolpath = segmentCount > 0 || layerCount > 0;
    maxLayer = layerCount > 0 ? layerCount - 1 : null;
    geometryWarning = resolveGeometryWarning(toolpath?.warnings);
    syncMetaVisibilityAttr();
    renderToolpath({ fitCamera: true });
  }

  function setMaxLayer(layer) {
    maxLayer =
      layer === null || layer === undefined
        ? null
        : Math.max(0, Math.floor(Number.isFinite(Number(layer)) ? Number(layer) : 0));
    renderToolpath({ fitCamera: false });
  }

  function setTravels(visible) {
    showTravels = Boolean(visible);
    renderToolpath({ fitCamera: false });
  }

  function getTravels() {
    return showTravels;
  }

  function setMetaExtra(text) {
    metaExtra = resolveMetaExtra(text);
    syncMetaVisibilityAttr();
    syncMeta();
  }

  function clear() {
    homeAnim = null;
    segments = [];
    segmentCount = 0;
    layerCount = 0;
    maxLayer = null;
    hasToolpath = false;
    geometryWarning = "";
    syncMetaVisibilityAttr();
    disposeLines();
    if (emptyEl) setHidden(emptyEl, false);
    syncHomeButton();
    syncTravelToggle();
    syncLayerSlider();
    syncMeta();
    renderer.render(scene, camera);
  }

  function tickHomeAnim() {
    if (!homeAnim) return;
    const running = tickOrbitHomeAnim(
      camera,
      controls.target,
      homeAnim,
      controls.dampingFactor
    );
    if (running) return;

    camera.near = homeAnim.near;
    camera.far = homeAnim.far;
    camera.updateProjectionMatrix();
    controls.minDistance = homeAnim.minDistance;
    controls.maxDistance = homeAnim.maxDistance;
    homeAnim = null;
  }

  function render() {
    if (destroyed) return;
    if (homeAnim) {
      tickHomeAnim();
      syncControlsAfterHomeStep();
    } else {
      controls.update();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  const resizeObserver =
    typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  if (resizeObserver) {
    resizeObserver.observe(previewEl);
  } else {
    window.addEventListener("resize", resize);
  }
  document.addEventListener(APP_CONFIG.themeChangeEvent, applyTheme);

  applyTheme();
  resize();
  syncMeta();
  renderer.render(scene, camera);
  requestAnimationFrame(render);

  return {
    setToolpath,
    setMaxLayer,
    setTravels,
    getTravels,
    resetView,
    setMetaExtra,
    clear,
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      document.removeEventListener(APP_CONFIG.themeChangeEvent, applyTheme);
      disposeLines();
      materials.extrusion.dispose();
      materials.travel.dispose();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
      homeBtn?.remove();
      travelToggle?.destroy();
      travelToggleBtn?.remove();
      layerSlider?.destroy();
      layerSliderEl?.remove();
      metaEl?.remove();
      delete previewEl.dataset.toolpathPreviewInit;
    },
  };
}

/** Wire every `.toolpath-preview` block in `root`. */
export function initToolpathPreviews(root = document) {
  const instances = [];
  root.querySelectorAll(".toolpath-preview").forEach((previewEl) => {
    const instance = initToolpathPreview(previewEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
