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
 * data-model-preview-expand-on-click — toggle maximise when clicking the canvas host
 * data-model-preview-actions — hover control visibility: `hover` (default),
 *   `always`, or `never`
 *
 * Call `initExpandableSurfaces()` after init when maximise attrs are used.
 *
 * API:
 *   const preview = initModelPreview(element);
 *   preview.setMesh({ positions, indices });
 *   preview.resetView();
 *   preview.setMetaExtra("PETG");
 *   preview.clear();
 */

import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { APP_CONFIG } from "../config.js";
import { setHidden, prefersReducedMotion } from "../utils/dom.js";
import { createIcon } from "../utils/icons.js";
import { createOrbitHomeAnim, tickOrbitHomeAnim } from "../utils/orbit-home.js";

/** @type {const} */
export const THREE_VERSION = "0.185.1";

const DEFAULT_ARIA_LABEL = "3D model preview";
const MAX_PIXEL_RATIO = 2;

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
 * Map maximise / home options onto expandable-surface and surface-actions chrome.
 * Call `initExpandableSurfaces()` after init (or on the page) to activate maximise.
 *
 * @param {HTMLElement} el
 * @param {{ maximize?: boolean, expandOnClick?: boolean, home?: boolean, actions?: string }} options
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

  if (!maximize && !expandOnClick && !home) {
    el.removeAttribute("data-expandable-surface-click");
    el.removeAttribute("data-expandable-surface-control");
    delete el.dataset.modelPreviewActions;
    return { maximize: false, expandOnClick: false, home: false, actionsVisibility };
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

  if (maximize || home) {
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

  return { maximize, expandOnClick, home, actionsVisibility };
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
    if (!model || destroyed) return;
    const pose = computeFitPose(camera, model);
    if (!pose) return;

    if (prefersReducedMotion()) {
      homeAnim = null;
      applyFitPose(previewEl, camera, controls, pose);
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
      setMesh() {},
      resetView() {},
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
  controls.addEventListener("start", () => {
    homeAnim = null;
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  ensureHomeButton();

  function applyTheme() {
    const background = readCssColor("--surface", "#ffffff");
    const text = readCssColor("--text", "#1f2328");
    const surface = readCssColor("--bg", "#ffffff");
    const accent = readCssColor("--accent", "#0969da");
    scene.background = new THREE.Color(background);
    hemisphere.color.set(text);
    hemisphere.groundColor.set(surface);
    keyLight.color.set(text);
    if (model?.material instanceof THREE.Material) {
      const material = /** @type {THREE.MeshStandardMaterial} */ (model.material);
      material.color.set(accent);
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
  }

  function render() {
    if (destroyed) return;
    if (homeAnim) {
      tickHomeAnim();
      // Resync OrbitControls internals from the orbit pose without damping motion.
      syncControlsAfterHomeStep();
    } else {
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
    syncHomeButton();
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
