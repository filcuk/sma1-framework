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
 * data-model-preview-expand-on-click — toggle maximise when clicking the canvas host
 * data-model-preview-actions — maximise control visibility: `hover` (default),
 *   `always`, or `never`
 *
 * Call `initExpandableSurfaces()` after init when maximise attrs are used.
 *
 * API:
 *   const preview = initModelPreview(element);
 *   preview.setMesh({ positions, indices });
 *   preview.setMetaExtra("PETG");
 *   preview.clear();
 */

import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { APP_CONFIG } from "../config.js";
import { setHidden } from "../utils/dom.js";

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
 * Map maximise options onto expandable-surface data attributes.
 * Call `initExpandableSurfaces()` after init (or on the page) to activate.
 *
 * @param {HTMLElement} el
 * @param {{ maximize?: boolean, expandOnClick?: boolean, actions?: string }} options
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
  const actionsVisibility = resolveActionsVisibility(
    typeof options.actions === "string"
      ? options.actions
      : el.dataset.modelPreviewActions
  );

  if (maximize) el.setAttribute("data-model-preview-maximize", "");
  else el.removeAttribute("data-model-preview-maximize");

  if (expandOnClick) el.setAttribute("data-model-preview-expand-on-click", "");
  else el.removeAttribute("data-model-preview-expand-on-click");

  if (!maximize && !expandOnClick) {
    el.removeAttribute("data-expandable-surface-click");
    el.removeAttribute("data-expandable-surface-control");
    delete el.dataset.modelPreviewActions;
    return { maximize: false, expandOnClick: false, actionsVisibility };
  }

  el.setAttribute("data-expandable-surface", "");
  if (!el.dataset.expandableSurfaceLabel?.trim()) {
    el.dataset.expandableSurfaceLabel =
      el.getAttribute("aria-label") || DEFAULT_ARIA_LABEL;
  }

  if (expandOnClick) el.setAttribute("data-expandable-surface-click", "");
  else el.removeAttribute("data-expandable-surface-click");

  if (maximize) {
    el.removeAttribute("data-expandable-surface-control");
    let actionsHost = el.querySelector(":scope > .surface-actions");
    if (!actionsHost) {
      actionsHost = document.createElement("div");
      actionsHost.className = "surface-actions";
      el.append(actionsHost);
    }
    el.dataset.modelPreviewActions = actionsVisibility;
  } else {
    el.setAttribute("data-expandable-surface-control", "false");
    delete el.dataset.modelPreviewActions;
  }

  return { maximize, expandOnClick, actionsVisibility };
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
 * @param {HTMLElement} el
 * @param {THREE.PerspectiveCamera} camera
 * @param {OrbitControls} controls
 * @param {THREE.Object3D} model
 */
function fitCameraToModel(el, camera, controls, model) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) return;

  const distance = (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35);
  camera.near = Math.max(maxDimension / 1000, 0.01);
  camera.far = Math.max(maxDimension * 20, 100);
  camera.position.set(
    center.x + distance * 0.9,
    center.y + distance * 0.75,
    center.z + distance * 0.9
  );
  camera.lookAt(center);
  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension * 0.1, 0.01);
  controls.maxDistance = Math.max(maxDimension * 20, 100);
  controls.update();

  // Ensure a first render after a hidden or newly laid-out host becomes visible.
  if (el.clientWidth === 0 || el.clientHeight === 0) return;
  camera.updateProjectionMatrix();
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
 *   actions?: string,
 * }} [options]
 * @returns {{
 *   setMesh: (mesh: {
 *     positions: ArrayLike<number>,
 *     indices: ArrayLike<number>,
 *     objectCount?: number,
 *     objects?: unknown[],
 *   }) => void,
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

  syncExpandableAttrs(previewEl, options);

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

  let renderer;
  let model = null;
  let destroyed = false;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch {
    if (emptyEl) {
      emptyEl.textContent = "3D preview is unavailable in this browser";
      setHidden(emptyEl, false);
    }
    return {
      setMesh() {},
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

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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

  function render() {
    if (destroyed) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  function setMesh(mesh) {
    const { positionValues, indexValues } = readMeshArrays(mesh);
    meshStats = computeMeshStats(positionValues, indexValues);
    objectCount = readObjectCount(mesh);
    disposeModel();

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
    syncMeta();
    renderer.render(scene, camera);
  }

  function setMetaExtra(text) {
    metaExtra = resolveMetaExtra(text);
    syncMetaVisibilityAttr();
    syncMeta();
  }

  function clear() {
    disposeModel();
    meshStats = null;
    objectCount = null;
    if (emptyEl) setHidden(emptyEl, false);
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
