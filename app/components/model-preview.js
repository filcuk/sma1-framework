/**
 * Interactive 3D mesh preview backed by vendored Three.js.
 *
 * Pages using this component must provide an import map for the `three`
 * specifier used by OrbitControls:
 *   "three": "./app/vendor/three/three.module.min.js"
 *
 * Markup:
 *   <div class="model-preview" id="my-preview"
 *     data-model-preview-size
 *     data-model-preview-triangles
 *     data-model-preview-meta="hover"
 *     data-model-preview-meta-extra="PETG"
 *     data-model-preview-maximize
 *     data-model-preview-home
 *     data-model-preview-animation
 *     data-model-preview-actions="hover"
 *     aria-label="3D model preview">
 *     <p class="model-preview__empty">No preview</p>
 *   </div>
 *
 * data-model-preview-size — show axis-aligned size (`W × L × H mm`)
 * data-model-preview-triangles — show triangle count
 * data-model-preview-vertices — show vertex count
 * data-model-preview-volume — show closed-mesh volume estimate (`mm³`)
 * data-model-preview-surface-area — show surface area (`mm²`)
 * data-model-preview-objects — show object count (`mesh.objectCount`,
 *   `mesh.objects.length`, or `1` for a loaded mesh)
 * data-model-preview-meta — when meta content is enabled: `hover` (default),
 *   `always`, `not-hover`, or `never`
 * data-model-preview-meta-extra — append app-specific text to the meta strip
 * data-model-preview-maximize — floating fullscreen control via expandable-surface
 * data-model-preview-home — floating reset-view (home) control
 * data-model-preview-rendering — floating Rendering mode dropdown (shaded / wireframe /
 *   ghosted / x-ray / arctic); off by default
 * data-model-preview-rendering-mode — initial mode when rendering is on (default `shaded`)
 * data-model-preview-animation — floating play/pause for preview animation (off by default).
 *   Default motion is slow OrbitControls auto-rotate; pass `onAnimationFrame` for a
 *   custom tick (and/or set `animationAutoRotate: false` / `data-model-preview-animation-auto-rotate="false"`).
 * data-model-preview-animation-playing — start playing when animation is on
 *   (default on; set `"false"` to start paused). Honours `prefers-reduced-motion`
 *   by starting paused.
 * data-model-preview-animation-auto-rotate — built-in orbit auto-rotate when animation
 *   is on (default on; set `"false"` for custom-only motion)
 * data-model-preview-expand-on-click — toggle maximise when clicking the canvas host
 * data-model-preview-actions — hover control visibility: `hover` (default),
 *   `always`, or `never`
 *
 * Call `initExpandableSurfaces()` after init when maximise attrs are used.
 *
 * API:
 *   const preview = initModelPreview(element, {
 *     animation: true,
 *     rendering: true,
 *     onAnimationFrame: ({ delta, elapsed, model, camera, controls, scene }) => { … },
 *   });
 *   preview.setMesh({ positions, indices });
 *   preview.resetView();
 *   preview.setRenderingMode("wireframe");
 *   preview.getRenderingMode();
 *   preview.setAnimationPlaying(true);
 *   preview.getAnimationPlaying();
 *   preview.setAnimationAutoRotate(false);
 *   preview.setOnAnimationFrame(handler);
 *   preview.setMetaExtra("PETG");
 *   preview.clear();
 */

import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { APP_CONFIG } from "../config.js";
import { setHidden, prefersReducedMotion, parseBooleanAttr } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";
import { createOrbitHomeAnim, tickOrbitHomeAnim } from "../utils/orbit-home.js";
import { initDropdown } from "./dropdown.js";

/** @type {const} */
export const THREE_VERSION = "0.185.1";

/** @typedef {"shaded" | "wireframe" | "ghosted" | "xray" | "arctic"} ModelRenderingMode */

const DEFAULT_ARIA_LABEL = "3D model preview";
const MAX_PIXEL_RATIO = 2;
/** OrbitControls autoRotateSpeed; 1 ≈ one full turn per minute at 60fps. */
const AUTO_ROTATE_SPEED = 1;
const GHOST_OPACITY = 0.35;

/** @type {readonly { value: ModelRenderingMode, label: string }[]} */
const RENDERING_MODE_OPTIONS = [
  { value: "shaded", label: "Shaded" },
  { value: "wireframe", label: "Wireframe" },
  { value: "ghosted", label: "Ghosted" },
  { value: "xray", label: "X-Ray" },
  { value: "arctic", label: "Arctic" },
];

/**
 * @param {string | null | undefined} value
 * @returns {ModelRenderingMode}
 */
function resolveRenderingMode(value) {
  const trimmed = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    trimmed === "shaded" ||
    trimmed === "wireframe" ||
    trimmed === "ghosted" ||
    trimmed === "xray" ||
    trimmed === "arctic"
  ) {
    return trimmed;
  }
  return "shaded";
}

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
 * Map maximise / home / animation options onto expandable-surface and surface-actions chrome.
 * Call `initExpandableSurfaces()` after init (or on the page) to activate maximise.
 *
 * @param {HTMLElement} el
 * @param {{
 *   maximize?: boolean,
 *   expandOnClick?: boolean,
 *   home?: boolean,
 *   animation?: boolean,
 *   rendering?: boolean,
 *   actions?: string,
 * }} options
 */
function syncExpandableAttrs(el, options) {
  const maximize =
    typeof options.maximize === "boolean"
      ? options.maximize
      : el.hasAttribute("data-model-preview-maximize");
  const expandOnClick =
    typeof options.expandOnClick === "boolean"
      ? options.expandOnClick
      : el.hasAttribute("data-model-preview-expand-on-click");
  const home =
    typeof options.home === "boolean"
      ? options.home
      : el.hasAttribute("data-model-preview-home");
  const animation =
    typeof options.animation === "boolean"
      ? options.animation
      : el.hasAttribute("data-model-preview-animation");
  const rendering =
    typeof options.rendering === "boolean"
      ? options.rendering
      : el.hasAttribute("data-model-preview-rendering");
  const actionsVisibility = resolveActionsVisibility(
    typeof options.actions === "string"
      ? options.actions
      : el.dataset.modelPreviewActions
  );

  if (maximize) el.setAttribute("data-model-preview-maximize", "");
  else el.removeAttribute("data-model-preview-maximize");

  if (expandOnClick) el.setAttribute("data-model-preview-expand-on-click", "");
  else el.removeAttribute("data-model-preview-expand-on-click");

  if (home) el.setAttribute("data-model-preview-home", "");
  else el.removeAttribute("data-model-preview-home");

  if (animation) el.setAttribute("data-model-preview-animation", "");
  else el.removeAttribute("data-model-preview-animation");

  if (rendering) el.setAttribute("data-model-preview-rendering", "");
  else el.removeAttribute("data-model-preview-rendering");

  if (!maximize && !expandOnClick && !home && !animation && !rendering) {
    el.removeAttribute("data-expandable-surface-click");
    el.removeAttribute("data-expandable-surface-control");
    delete el.dataset.modelPreviewActions;
    return {
      maximize: false,
      expandOnClick: false,
      home: false,
      animation: false,
      rendering: false,
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

  if (maximize || home || animation || rendering) {
    let actionsHost = el.querySelector(":scope > .surface-actions");
    if (!actionsHost) {
      actionsHost = document.createElement("div");
      actionsHost.className = "surface-actions";
      el.append(actionsHost);
    }
    el.dataset.modelPreviewActions = actionsVisibility;
  } else {
    delete el.dataset.modelPreviewActions;
  }

  return { maximize, expandOnClick, home, animation, rendering, actionsVisibility };
}

/**
 * @param {HTMLElement} el
 * @param {{ animationPlaying?: boolean }} options
 * @param {boolean} animationEnabled
 */
function resolveAnimationPlaying(el, options, animationEnabled) {
  if (!animationEnabled) return false;
  if (typeof options.animationPlaying === "boolean") {
    return options.animationPlaying;
  }
  const raw = el.getAttribute("data-model-preview-animation-playing");
  if (raw === null) return true;
  return parseBooleanAttr(raw) ?? true;
}

/**
 * @param {HTMLElement} el
 * @param {{ animationAutoRotate?: boolean }} options
 */
function resolveAnimationAutoRotate(el, options) {
  if (typeof options.animationAutoRotate === "boolean") {
    return options.animationAutoRotate;
  }
  const raw = el.getAttribute("data-model-preview-animation-auto-rotate");
  if (raw === null) return true;
  return parseBooleanAttr(raw) ?? true;
}

/**
 * @param {string} name
 * @param {string} fallback
 */
function readCssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * @param {number} value
 */
function formatMeshNumber(value) {
  if (!Number.isFinite(value)) return "";
  const absolute = Math.abs(value);
  const digits = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

/**
 * @param {unknown} mesh
 */
function readObjectCount(mesh) {
  if (!mesh || typeof mesh !== "object") return null;
  const counted = /** @type {{ objectCount?: unknown, objects?: unknown }} */ (mesh);
  if (Number.isFinite(Number(counted.objectCount))) {
    return Math.max(0, Math.floor(Number(counted.objectCount)));
  }
  if (Array.isArray(counted.objects)) return counted.objects.length;
  return 1;
}

/**
 * @param {number[]} positions
 * @param {number[]} indices
 */
function computeMeshStats(positions, indices) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let volume = 0;
  let surfaceArea = 0;

  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const bx = positions[b];
    const by = positions[b + 1];
    const bz = positions[b + 2];
    const cx = positions[c];
    const cy = positions[c + 1];
    const cz = positions[c + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    surfaceArea += Math.hypot(crossX, crossY, crossZ) * 0.5;
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }

  return {
    vertices: positions.length / 3,
    triangles: indices.length / 3,
    width: maxX - minX,
    length: maxY - minY,
    height: maxZ - minZ,
    volume: Math.abs(volume) / 6,
    surfaceArea,
  };
}

/**
 * @param {unknown} mesh
 */
function readMeshArrays(mesh) {
  if (!mesh || typeof mesh !== "object") {
    throw new TypeError("mesh must be an object");
  }

  const positions = /** @type {{ positions?: unknown }} */ (mesh).positions;
  const indices = /** @type {{ indices?: unknown }} */ (mesh).indices;
  if (!positions || typeof positions.length !== "number" || positions.length % 3 !== 0) {
    throw new TypeError("mesh.positions must contain x, y, z triplets");
  }
  if (!indices || typeof indices.length !== "number" || indices.length % 3 !== 0) {
    throw new TypeError("mesh.indices must contain triangle triplets");
  }

  const positionValues = Array.from(positions);
  const indexValues = Array.from(indices);
  if (
    positionValues.some((value) => !Number.isFinite(value)) ||
    indexValues.some(
      (value) =>
        !Number.isInteger(value) || value < 0 || value >= positionValues.length / 3
    )
  ) {
    throw new TypeError("mesh contains invalid position or index values");
  }

  return { positionValues, indexValues };
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Object3D} model
 * @returns {{
 *   position: THREE.Vector3,
 *   target: THREE.Vector3,
 *   near: number,
 *   far: number,
 *   minDistance: number,
 *   maxDistance: number,
 * } | null}
 */
function computeFitPose(camera, model) {
  const bounds = new THREE.Box3().setFromObject(model);
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
 * @param {HTMLElement} el
 * @param {THREE.PerspectiveCamera} camera
 * @param {OrbitControls} controls
 * @param {ReturnType<typeof computeFitPose>} pose
 */
function applyFitPose(el, camera, controls, pose) {
  if (!pose) return;
  camera.near = pose.near;
  camera.far = pose.far;
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  controls.target.copy(pose.target);
  controls.minDistance = pose.minDistance;
  controls.maxDistance = pose.maxDistance;
  controls.update();

  // Ensure a first render after a hidden or newly laid-out host becomes visible.
  if (el.clientWidth === 0 || el.clientHeight === 0) return;
  camera.updateProjectionMatrix();
}

/**
 * @param {HTMLElement} el
 * @param {THREE.PerspectiveCamera} camera
 * @param {OrbitControls} controls
 * @param {THREE.Object3D} model
 */
function fitCameraToModel(el, camera, controls, model) {
  applyFitPose(el, camera, controls, computeFitPose(camera, model));
}

/**
 * @param {HTMLElement} previewEl
 * @param {{
 *   size?: boolean,
 *   triangles?: boolean,
 *   vertices?: boolean,
 *   volume?: boolean,
 *   surfaceArea?: boolean,
 *   objects?: boolean,
 *   meta?: string,
 *   metaExtra?: string | string[],
 *   maximize?: boolean,
 *   expandOnClick?: boolean,
 *   home?: boolean,
 *   animation?: boolean,
 *   rendering?: boolean,
 *   renderingMode?: ModelRenderingMode | string,
 *   animationPlaying?: boolean,
 *   animationAutoRotate?: boolean,
 *   onAnimationFrame?: ((ctx: {
 *     delta: number,
 *     elapsed: number,
 *     playing: boolean,
 *     model: THREE.Object3D | null,
 *     camera: THREE.PerspectiveCamera,
 *     controls: OrbitControls,
 *     scene: THREE.Scene,
 *   }) => void) | null,
 *   actions?: string,
 * }} [options]
 * @returns {{
 *   setMesh: (mesh: {
 *     positions: ArrayLike<number>,
 *     indices: ArrayLike<number>,
 *     objectCount?: number,
 *     objects?: unknown[],
 *   }) => void,
 *   resetView: () => void,
 *   setRenderingMode: (mode: ModelRenderingMode | string) => void,
 *   getRenderingMode: () => ModelRenderingMode,
 *   setAnimationPlaying: (playing: boolean) => void,
 *   getAnimationPlaying: () => boolean,
 *   setAnimationAutoRotate: (enabled: boolean) => void,
 *   getAnimationAutoRotate: () => boolean,
 *   setOnAnimationFrame: (handler: ((ctx: {
 *     delta: number,
 *     elapsed: number,
 *     playing: boolean,
 *     model: THREE.Object3D | null,
 *     camera: THREE.PerspectiveCamera,
 *     controls: OrbitControls,
 *     scene: THREE.Scene,
 *   }) => void) | null) => void,
 *   setMetaExtra: (text: string | string[] | null | undefined) => void,
 *   clear: () => void,
 *   destroy: () => void,
 * } | null}
 */
export function initModelPreview(previewEl, options = {}) {
  if (!(previewEl instanceof HTMLElement)) return null;
  if (!previewEl.classList.contains("model-preview")) return null;
  // Toolpath previews reuse the surface class but have their own init.
  if (previewEl.classList.contains("toolpath-preview")) return null;
  if (previewEl.dataset.modelPreviewInit !== undefined) return null;

  previewEl.dataset.modelPreviewInit = "";
  const emptyEl = previewEl.querySelector(".model-preview__empty");
  const ariaLabel = previewEl.getAttribute("aria-label") || DEFAULT_ARIA_LABEL;

  const showSize =
    typeof options.size === "boolean"
      ? options.size
      : previewEl.hasAttribute("data-model-preview-size");
  const showTriangles =
    typeof options.triangles === "boolean"
      ? options.triangles
      : previewEl.hasAttribute("data-model-preview-triangles");
  const showVertices =
    typeof options.vertices === "boolean"
      ? options.vertices
      : previewEl.hasAttribute("data-model-preview-vertices");
  const showVolume =
    typeof options.volume === "boolean"
      ? options.volume
      : previewEl.hasAttribute("data-model-preview-volume");
  const showSurfaceArea =
    typeof options.surfaceArea === "boolean"
      ? options.surfaceArea
      : previewEl.hasAttribute("data-model-preview-surface-area");
  const showObjects =
    typeof options.objects === "boolean"
      ? options.objects
      : previewEl.hasAttribute("data-model-preview-objects");
  const fixedMetaContent =
    showSize ||
    showTriangles ||
    showVertices ||
    showVolume ||
    showSurfaceArea ||
    showObjects;
  const configuredMetaVisibility = resolveMetaVisibility(
    typeof options.meta === "string"
      ? options.meta
      : previewEl.dataset.modelPreviewMeta
  );
  let metaExtra = resolveMetaExtra(
    options.metaExtra !== undefined
      ? options.metaExtra
      : previewEl.dataset.modelPreviewMetaExtra
  );
  let hasMetaContent = fixedMetaContent || metaExtra !== "";
  let metaVisibility = hasMetaContent ? configuredMetaVisibility : "never";

  const expandState = syncExpandableAttrs(previewEl, options);
  const showHome = expandState.home;
  const showAnimation = expandState.animation;
  const showRendering = expandState.rendering;
  let renderingMode = resolveRenderingMode(
    typeof options.renderingMode === "string"
      ? options.renderingMode
      : previewEl.dataset.modelPreviewRenderingMode
  );
  if (showRendering) {
    previewEl.dataset.modelPreviewRenderingMode = renderingMode;
  } else {
    delete previewEl.dataset.modelPreviewRenderingMode;
  }
  let animationPlaying =
    resolveAnimationPlaying(previewEl, options, showAnimation) &&
    !prefersReducedMotion();
  let animationAutoRotate = resolveAnimationAutoRotate(previewEl, options);
  /** @type {((ctx: {
   *   delta: number,
   *   elapsed: number,
   *   playing: boolean,
   *   model: THREE.Object3D | null,
   *   camera: THREE.PerspectiveCamera,
   *   controls: OrbitControls,
   *   scene: THREE.Scene,
   * }) => void) | null} */
  let onAnimationFrame =
    typeof options.onAnimationFrame === "function" ? options.onAnimationFrame : null;
  let animationElapsed = 0;
  let lastAnimationFrameTime = performance.now();

  if (showAnimation) {
    previewEl.setAttribute(
      "data-model-preview-animation-playing",
      animationPlaying ? "true" : "false"
    );
    previewEl.setAttribute(
      "data-model-preview-animation-auto-rotate",
      animationAutoRotate ? "true" : "false"
    );
  } else {
    previewEl.removeAttribute("data-model-preview-animation-playing");
    previewEl.removeAttribute("data-model-preview-animation-auto-rotate");
  }

  if (showSize) previewEl.setAttribute("data-model-preview-size", "");
  else previewEl.removeAttribute("data-model-preview-size");
  if (showTriangles) previewEl.setAttribute("data-model-preview-triangles", "");
  else previewEl.removeAttribute("data-model-preview-triangles");
  if (showVertices) previewEl.setAttribute("data-model-preview-vertices", "");
  else previewEl.removeAttribute("data-model-preview-vertices");
  if (showVolume) previewEl.setAttribute("data-model-preview-volume", "");
  else previewEl.removeAttribute("data-model-preview-volume");
  if (showSurfaceArea) previewEl.setAttribute("data-model-preview-surface-area", "");
  else previewEl.removeAttribute("data-model-preview-surface-area");
  if (showObjects) previewEl.setAttribute("data-model-preview-objects", "");
  else previewEl.removeAttribute("data-model-preview-objects");

  if (metaExtra) previewEl.dataset.modelPreviewMetaExtra = metaExtra;
  else delete previewEl.dataset.modelPreviewMetaExtra;

  if (hasMetaContent) {
    previewEl.dataset.modelPreviewMeta = metaVisibility;
  } else {
    delete previewEl.dataset.modelPreviewMeta;
  }

  /** @type {HTMLParagraphElement | null} */
  let metaEl = null;
  /** @type {HTMLButtonElement | null} */
  let homeBtn = null;
  /** @type {HTMLButtonElement | null} */
  let animationBtn = null;
  /** @type {HTMLElement | null} */
  let renderingHost = null;
  /** @type {HTMLButtonElement | null} */
  let renderingTrigger = null;
  /** @type {ReturnType<typeof initDropdown> | null} */
  let renderingDropdownApi = null;
  /** @type {THREE.LineSegments | null} */
  let edgeLines = null;
  /** @type {THREE.Points | null} */
  let vertexPoints = null;
  /** @type {THREE.Mesh | null} */
  let shadowGround = null;
  /** @type {ReturnType<typeof computeMeshStats> | null} */
  let meshStats = null;
  /** @type {number | null} */
  let objectCount = null;

  function syncMetaVisibilityAttr() {
    hasMetaContent = fixedMetaContent || metaExtra !== "";
    metaVisibility = hasMetaContent ? configuredMetaVisibility : "never";
    if (metaExtra) previewEl.dataset.modelPreviewMetaExtra = metaExtra;
    else delete previewEl.dataset.modelPreviewMetaExtra;
    if (hasMetaContent) {
      previewEl.dataset.modelPreviewMeta = metaVisibility;
    } else {
      delete previewEl.dataset.modelPreviewMeta;
    }
  }

  function ensureMetaEl() {
    if (!hasMetaContent || metaVisibility === "never") {
      if (metaEl) setHidden(metaEl, true);
      return null;
    }
    if (metaEl?.isConnected) return metaEl;
    metaEl = previewEl.querySelector(":scope > .model-preview__meta");
    if (!(metaEl instanceof HTMLParagraphElement)) {
      metaEl = document.createElement("p");
      metaEl.className = "model-preview__meta";
      previewEl.append(metaEl);
    }
    return metaEl;
  }

  function syncMeta() {
    const meta = ensureMetaEl();
    if (!meta) return;

    /** @type {string[]} */
    const parts = [];
    if (meshStats) {
      if (showSize) {
        parts.push(
          `${formatMeshNumber(meshStats.width)} × ${formatMeshNumber(
            meshStats.length
          )} × ${formatMeshNumber(meshStats.height)} mm`
        );
      }
      if (showTriangles) {
        parts.push(`${meshStats.triangles.toLocaleString()} triangles`);
      }
      if (showVertices) {
        parts.push(`${meshStats.vertices.toLocaleString()} vertices`);
      }
      if (showVolume) {
        parts.push(`${formatMeshNumber(meshStats.volume)} mm³`);
      }
      if (showSurfaceArea) {
        parts.push(`${formatMeshNumber(meshStats.surfaceArea)} mm²`);
      }
      if (showObjects && objectCount !== null) {
        parts.push(`${objectCount.toLocaleString()} object${objectCount === 1 ? "" : "s"}`);
      }
    }
    if (metaExtra) parts.push(metaExtra);

    if (!parts.length) {
      meta.textContent = "";
      setHidden(meta, true);
      return;
    }

    meta.textContent = parts.join(" · ");
    setHidden(meta, false);
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
    homeBtn.disabled = !model;
  }

  function syncAnimationControls() {
    if (!showAnimation) {
      controls.autoRotate = false;
      return;
    }
    controls.autoRotate =
      animationPlaying && animationAutoRotate && Boolean(model);
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    previewEl.setAttribute(
      "data-model-preview-animation-playing",
      animationPlaying ? "true" : "false"
    );
    previewEl.setAttribute(
      "data-model-preview-animation-auto-rotate",
      animationAutoRotate ? "true" : "false"
    );
    if (!animationBtn) return;
    animationBtn.disabled = !model;
    const label = animationPlaying ? "Pause animation" : "Play animation";
    animationBtn.dataset.tooltip = label;
    animationBtn.setAttribute("aria-label", label);
    animationBtn.replaceChildren(
      createIcon(animationPlaying ? "pause" : "play", {
        className: "btn-icon-svg",
      })
    );
  }

  function setAnimationPlaying(playing) {
    if (!showAnimation) return;
    animationPlaying = Boolean(playing);
    lastAnimationFrameTime = performance.now();
    syncAnimationControls();
  }

  function getAnimationPlaying() {
    return showAnimation ? animationPlaying : false;
  }

  function setAnimationAutoRotate(enabled) {
    animationAutoRotate = Boolean(enabled);
    syncAnimationControls();
  }

  function getAnimationAutoRotate() {
    return animationAutoRotate;
  }

  function setOnAnimationFrame(handler) {
    onAnimationFrame = typeof handler === "function" ? handler : null;
  }

  function tickCustomAnimation() {
    if (!showAnimation || !animationPlaying) return;
    const now = performance.now();
    const delta = Math.min(Math.max((now - lastAnimationFrameTime) / 1000, 0), 0.1);
    lastAnimationFrameTime = now;
    if (!onAnimationFrame) return;
    animationElapsed += delta;
    onAnimationFrame({
      delta,
      elapsed: animationElapsed,
      playing: true,
      model,
      camera,
      controls,
      scene,
    });
  }

  function ensureHomeButton() {
    if (!showHome) return null;
    if (homeBtn?.isConnected) return homeBtn;
    const host = ensureActionsHost();
    homeBtn = host.querySelector(".model-preview__home");
    if (!(homeBtn instanceof HTMLButtonElement)) {
      homeBtn = document.createElement("button");
      homeBtn.type = "button";
      homeBtn.className = "model-preview__home btn btn-slim btn-icon";
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

  function ensureAnimationButton() {
    if (!showAnimation) return null;
    if (animationBtn?.isConnected) return animationBtn;
    const host = ensureActionsHost();
    animationBtn = host.querySelector(".model-preview__animation");
    if (!(animationBtn instanceof HTMLButtonElement)) {
      animationBtn = document.createElement("button");
      animationBtn.type = "button";
      animationBtn.className = "model-preview__animation btn btn-slim btn-icon";
      animationBtn.dataset.tooltipPosition = "top";
      animationBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        setAnimationPlaying(!animationPlaying);
      });
      // `.surface-actions` is row-reverse; last icon before any left slider is leftmost.
      host.append(animationBtn);
    }
    syncAnimationControls();
    return animationBtn;
  }

  function syncRenderingMenuSelection() {
    if (!renderingHost) return;
    renderingHost.querySelectorAll(".dropdown-menu-item").forEach((item) => {
      const selected = item.dataset.value === renderingMode;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-checked", selected ? "true" : "false");
    });
  }

  function syncRenderingControl() {
    if (!renderingTrigger) return;
    renderingTrigger.disabled = !model;
  }

  /**
   * Place rendering in `.surface-actions`. The strip is `row-reverse`, so earlier
   * DOM order is further right — insert before home for … | home | rendering | maximise.
   * @param {HTMLElement} actionsHost
   * @param {HTMLElement} host
   */
  function placeRenderingControl(actionsHost, host) {
    const homeEl = actionsHost.querySelector(".model-preview__home");
    if (homeEl) actionsHost.insertBefore(host, homeEl);
    else if (!host.isConnected) actionsHost.append(host);
  }

  function ensureRenderingDropdown() {
    if (!showRendering) return null;
    const actionsHost = ensureActionsHost();
    if (renderingHost?.isConnected) {
      // Keep between maximise and home if peers remount.
      placeRenderingControl(actionsHost, renderingHost);
      syncRenderingControl();
      return renderingHost;
    }
    renderingHost = actionsHost.querySelector(".model-preview__rendering");
    if (!(renderingHost instanceof HTMLElement)) {
      const triggerId = previewEl.id
        ? `${previewEl.id}-rendering-trigger`
        : `model-preview-rendering-${Math.random().toString(36).slice(2, 9)}`;
      const menuId = `${triggerId}-menu`;

      renderingHost = document.createElement("div");
      renderingHost.className = "model-preview__rendering dropdown";

      renderingTrigger = document.createElement("button");
      renderingTrigger.type = "button";
      renderingTrigger.id = triggerId;
      renderingTrigger.className =
        "btn btn-slim btn-icon dropdown-trigger model-preview__rendering-trigger";
      renderingTrigger.dataset.tooltip = "Rendering";
      renderingTrigger.dataset.tooltipPosition = "top";
      renderingTrigger.setAttribute("aria-label", "Rendering");
      renderingTrigger.setAttribute("aria-haspopup", "menu");
      renderingTrigger.setAttribute("aria-expanded", "false");
      renderingTrigger.setAttribute("aria-controls", menuId);
      renderingTrigger.append(createIcon("cube", { className: "btn-icon-svg" }));
      renderingTrigger.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      const menu = document.createElement("ul");
      menu.id = menuId;
      menu.className = "dropdown-menu hidden";
      menu.setAttribute("role", "menu");
      menu.hidden = true;

      for (const option of RENDERING_MODE_OPTIONS) {
        const li = document.createElement("li");
        li.setAttribute("role", "none");
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dropdown-menu-item";
        item.setAttribute("role", "menuitemradio");
        item.dataset.value = option.value;
        item.dataset.tooltip = option.label;
        item.dataset.tooltipAnchor = `#${CSS.escape(triggerId)}`;
        item.textContent = option.label;
        li.append(item);
        menu.append(li);
      }

      renderingHost.append(renderingTrigger, menu);
      placeRenderingControl(actionsHost, renderingHost);

      renderingDropdownApi = initDropdown(renderingHost, {
        fixed: true,
        fixedAlign: "end",
        onSelect: ({ value }) => {
          setRenderingMode(value);
        },
      });
    } else {
      renderingTrigger = renderingHost.querySelector(
        ".model-preview__rendering-trigger"
      );
      placeRenderingControl(actionsHost, renderingHost);
    }
    syncRenderingMenuSelection();
    syncRenderingControl();
    return renderingHost;
  }

  function disposeOverlays() {
    if (edgeLines) {
      scene.remove(edgeLines);
      edgeLines.geometry.dispose();
      if (edgeLines.material instanceof THREE.Material) edgeLines.material.dispose();
      edgeLines = null;
    }
    if (vertexPoints) {
      scene.remove(vertexPoints);
      vertexPoints.geometry.dispose();
      if (vertexPoints.material instanceof THREE.Material) {
        vertexPoints.material.dispose();
      }
      vertexPoints = null;
    }
  }

  function disposeShadowGround() {
    if (!shadowGround) return;
    scene.remove(shadowGround);
    shadowGround.geometry.dispose();
    if (shadowGround.material instanceof THREE.Material) {
      shadowGround.material.dispose();
    }
    shadowGround = null;
  }

  function syncShadowGround() {
    const enabled = renderingMode === "arctic" && Boolean(model);
    if (!enabled) {
      disposeShadowGround();
      return;
    }
    if (!shadowGround) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
      });
      shadowGround = new THREE.Mesh(geometry, material);
      shadowGround.rotation.x = -Math.PI / 2;
      shadowGround.receiveShadow = true;
      scene.add(shadowGround);
    }
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1) * 4;
    shadowGround.scale.set(span, span, 1);
    shadowGround.position.set(center.x, bounds.min.y - 0.02, center.z);

    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.radius = 4;
    keyLight.shadow.bias = -0.0005;
    const extent = Math.max(size.x, size.y, size.z, 1) * 2;
    const shadowCam = keyLight.shadow.camera;
    shadowCam.left = -extent;
    shadowCam.right = extent;
    shadowCam.top = extent;
    shadowCam.bottom = -extent;
    shadowCam.near = 0.1;
    shadowCam.far = extent * 6;
    shadowCam.updateProjectionMatrix();
    keyLight.position.set(center.x + extent, center.y + extent * 1.5, center.z + extent);
    keyLight.target.position.copy(center);
    if (!keyLight.target.parent) scene.add(keyLight.target);
    keyLight.target.updateMatrixWorld();
  }

  function syncOverlays() {
    disposeOverlays();
    if (!model) return;

    const needEdges = renderingMode === "wireframe" || renderingMode === "xray";
    const needPoints = renderingMode === "wireframe";
    if (!needEdges && !needPoints) return;

    const lineColor = renderingMode === "arctic" ? 0x333333 : readCssColor("--text", "#1f2328");
    const depthTest = renderingMode !== "xray";

    if (needEdges) {
      const wireGeo = new THREE.WireframeGeometry(model.geometry);
      const lineMat = new THREE.LineBasicMaterial({
        color: lineColor,
        depthTest,
        transparent: !depthTest,
        opacity: depthTest ? 1 : 0.9,
      });
      edgeLines = new THREE.LineSegments(wireGeo, lineMat);
      edgeLines.renderOrder = 2;
      scene.add(edgeLines);
    }

    if (needPoints) {
      const positions = model.geometry.getAttribute("position");
      const pointsGeo = new THREE.BufferGeometry();
      pointsGeo.setAttribute("position", positions.clone());
      const pointsMat = new THREE.PointsMaterial({
        color: lineColor,
        size: 3,
        sizeAttenuation: false,
        depthTest: true,
      });
      vertexPoints = new THREE.Points(pointsGeo, pointsMat);
      vertexPoints.renderOrder = 3;
      scene.add(vertexPoints);
    }
  }

  function applyRenderingMode() {
    if (showRendering) {
      previewEl.dataset.modelPreviewRenderingMode = renderingMode;
    }

    const arctic = renderingMode === "arctic";
    renderer.shadowMap.enabled = arctic;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    keyLight.castShadow = arctic;

    if (model?.material instanceof THREE.Material) {
      const material = /** @type {THREE.MeshStandardMaterial} */ (model.material);
      const ghosted = renderingMode === "ghosted" || renderingMode === "xray";
      const hideFill = renderingMode === "wireframe";

      model.visible = !hideFill;
      model.castShadow = arctic;
      model.receiveShadow = arctic;

      material.transparent = ghosted;
      material.opacity = ghosted ? GHOST_OPACITY : 1;
      material.depthWrite = !ghosted;
      material.wireframe = false;
      material.color.set(
        arctic ? 0xffffff : readCssColor("--accent", "#0969da")
      );
      material.needsUpdate = true;
    }

    syncOverlays();
    syncShadowGround();
    if (renderingMode !== "arctic") {
      keyLight.position.set(1, 2, 3);
      if (keyLight.target.parent) {
        keyLight.target.position.set(0, 0, 0);
        keyLight.target.updateMatrixWorld();
      }
    }
    syncRenderingMenuSelection();
    syncRenderingControl();
  }

  function setRenderingMode(mode) {
    if (!showRendering) return;
    renderingMode = resolveRenderingMode(mode);
    applyRenderingMode();
    applyTheme();
  }

  function getRenderingMode() {
    return renderingMode;
  }

  let renderer;
  let model = null;
  let destroyed = false;
  /** @type {ReturnType<typeof createOrbitHomeAnim> | null} */
  let homeAnim = null;

  function clearOrbitInertia() {
    // OrbitControls applies the full remaining sphericalDelta when damping is
    // turned off for one update — restore the pre-clear pose so home does not flash.
    const frozenPos = camera.position.clone();
    const frozenTarget = controls.target.clone();
    const damping = controls.enableDamping;
    const rotating = controls.autoRotate;
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(frozenPos);
    controls.target.copy(frozenTarget);
    controls.update();
    controls.enableDamping = damping;
    controls.autoRotate = rotating;
  }

  function syncControlsAfterHomeStep() {
    const damping = controls.enableDamping;
    // Home easing must not compete with orbit auto-rotate; resume via syncAnimationControls.
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }

  function resetView() {
    if (!model || destroyed) return;
    const pose = computeFitPose(camera, model);
    if (!pose) return;

    if (prefersReducedMotion()) {
      homeAnim = null;
      controls.autoRotate = false;
      applyFitPose(previewEl, camera, controls, pose);
      syncAnimationControls();
      lastAnimationFrameTime = performance.now();
      renderer.render(scene, camera);
      return;
    }

    controls.autoRotate = false;
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
      setMesh() {},
      resetView() {},
      setRenderingMode() {},
      getRenderingMode() {
        return renderingMode;
      },
      setAnimationPlaying() {},
      getAnimationPlaying() {
        return false;
      },
      setAnimationAutoRotate() {},
      getAnimationAutoRotate() {
        return animationAutoRotate;
      },
      setOnAnimationFrame() {},
      setMetaExtra(text) {
        metaExtra = resolveMetaExtra(text);
        syncMetaVisibilityAttr();
      },
      clear() {},
      destroy() {
        delete previewEl.dataset.modelPreviewInit;
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
  controls.autoRotate = false;
  controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  controls.addEventListener("start", () => {
    if (!homeAnim) return;
    homeAnim = null;
    syncAnimationControls();
    lastAnimationFrameTime = performance.now();
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  ensureHomeButton();
  ensureRenderingDropdown();
  ensureAnimationButton();
  syncAnimationControls();
  applyRenderingMode();

  function applyTheme() {
    const background =
      renderingMode === "arctic"
        ? "#ffffff"
        : readCssColor("--surface", "#ffffff");
    const text = readCssColor("--text", "#1f2328");
    const surface = readCssColor("--bg", "#ffffff");
    const accent =
      renderingMode === "arctic" ? "#ffffff" : readCssColor("--accent", "#0969da");
    scene.background = new THREE.Color(background);
    hemisphere.color.set(renderingMode === "arctic" ? 0xffffff : text);
    hemisphere.groundColor.set(renderingMode === "arctic" ? 0xe8e8e8 : surface);
    keyLight.color.set(renderingMode === "arctic" ? 0xffffff : text);
    if (model?.material instanceof THREE.Material) {
      const material = /** @type {THREE.MeshStandardMaterial} */ (model.material);
      material.color.set(accent);
    }
    if (edgeLines?.material instanceof THREE.Material) {
      /** @type {THREE.LineBasicMaterial} */ (edgeLines.material).color.set(
        renderingMode === "arctic" ? 0x333333 : text
      );
    }
    if (vertexPoints?.material instanceof THREE.Material) {
      /** @type {THREE.PointsMaterial} */ (vertexPoints.material).color.set(
        renderingMode === "arctic" ? 0x333333 : text
      );
    }
  }

  function resize() {
    const width = Math.max(previewEl.clientWidth, 1);
    const height = Math.max(previewEl.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function disposeModel() {
    disposeOverlays();
    disposeShadowGround();
    if (!model) return;
    scene.remove(model);
    model.geometry.dispose();
    if (model.material instanceof THREE.Material) model.material.dispose();
    model = null;
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
    // Resume play/pause animation (built-in orbit and/or custom frame hook).
    syncAnimationControls();
    lastAnimationFrameTime = performance.now();
  }

  function render() {
    if (destroyed) return;
    if (homeAnim) {
      tickHomeAnim();
      if (homeAnim) {
        // Still easing — keep orbit auto-rotate off so home can settle.
        syncControlsAfterHomeStep();
        lastAnimationFrameTime = performance.now();
      } else {
        tickCustomAnimation();
        controls.update();
      }
    } else {
      tickCustomAnimation();
      controls.update();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  function setMesh(mesh) {
    const { positionValues, indexValues } = readMeshArrays(mesh);
    meshStats = computeMeshStats(positionValues, indexValues);
    objectCount = readObjectCount(mesh);
    disposeModel();
    homeAnim = null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positionValues, 3)
    );
    geometry.setIndex(indexValues);
    geometry.computeVertexNormals();
    // STL coordinates are Z-up; Three.js cameras are conventionally Y-up.
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: readCssColor("--accent", "#0969da"),
      roughness: 0.72,
      metalness: 0.05,
      flatShading: true,
    });
    model = new THREE.Mesh(geometry, material);
    scene.add(model);
    fitCameraToModel(previewEl, camera, controls, model);
    if (emptyEl) setHidden(emptyEl, true);
    applyRenderingMode();
    syncHomeButton();
    syncAnimationControls();
    syncMeta();
    renderer.render(scene, camera);
  }

  function setMetaExtra(text) {
    metaExtra = resolveMetaExtra(text);
    syncMetaVisibilityAttr();
    syncMeta();
  }

  function clear() {
    homeAnim = null;
    disposeModel();
    meshStats = null;
    objectCount = null;
    if (emptyEl) setHidden(emptyEl, false);
    syncHomeButton();
    syncAnimationControls();
    syncRenderingControl();
    syncMeta();
    renderer.render(scene, camera);
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
    setMesh,
    resetView,
    setRenderingMode,
    getRenderingMode,
    setAnimationPlaying,
    getAnimationPlaying,
    setAnimationAutoRotate,
    getAnimationAutoRotate,
    setOnAnimationFrame,
    setMetaExtra,
    clear,
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      document.removeEventListener(APP_CONFIG.themeChangeEvent, applyTheme);
      disposeModel();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
      renderingDropdownApi?.destroy();
      renderingHost?.remove();
      animationBtn?.remove();
      homeBtn?.remove();
      metaEl?.remove();
      delete previewEl.dataset.modelPreviewInit;
    },
  };
}

/** Wire every mesh `.model-preview` block in `root` (skips toolpath hosts). */
export function initModelPreviews(root = document) {
  const instances = [];
  root.querySelectorAll(".model-preview:not(.toolpath-preview)").forEach((previewEl) => {
    const instance = initModelPreview(previewEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
