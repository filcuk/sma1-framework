/**
 * Interactive 3D mesh preview backed by vendored Three.js.
 *
 * Pages using this component must provide an import map for the `three`
 * specifier used by OrbitControls:
 *   "three": "./app/vendor/three/three.module.min.js"
 *
 * Markup:
 *   <div class="model-preview" id="my-preview" aria-label="3D model preview">
 *     <p class="model-preview__empty">No preview</p>
 *   </div>
 *
 * API:
 *   const preview = initModelPreview(element);
 *   preview.setMesh({ positions, indices });
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
 * @param {string} name
 * @param {string} fallback
 */
function readCssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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
 * @returns {{ setMesh: (mesh: { positions: ArrayLike<number>, indices: ArrayLike<number> }) => void, clear: () => void, destroy: () => void } | null}
 */
export function initModelPreview(previewEl) {
  if (!(previewEl instanceof HTMLElement)) return null;
  if (!previewEl.classList.contains("model-preview")) return null;
  if (previewEl.dataset.modelPreviewInit !== undefined) return null;

  previewEl.dataset.modelPreviewInit = "";
  const emptyEl = previewEl.querySelector(".model-preview__empty");
  const ariaLabel = previewEl.getAttribute("aria-label") || DEFAULT_ARIA_LABEL;

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
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(1, 2, 3);
  scene.add(hemisphere, keyLight);

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
    renderer.render(scene, camera);
  }

  function clear() {
    disposeModel();
    if (emptyEl) setHidden(emptyEl, false);
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
  renderer.render(scene, camera);
  requestAnimationFrame(render);

  return {
    setMesh,
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
      delete previewEl.dataset.modelPreviewInit;
    },
  };
}

/** Wire every `.model-preview` block in `root`. */
export function initModelPreviews(root = document) {
  const instances = [];
  root.querySelectorAll(".model-preview").forEach((previewEl) => {
    const instance = initModelPreview(previewEl);
    if (instance) instances.push(instance);
  });
  return instances;
}
