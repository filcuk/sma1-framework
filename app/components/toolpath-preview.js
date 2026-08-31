/**
 * Interactive Three.js G-code toolpath preview.
 *
 * The host intentionally reuses the `.model-preview` surface styles:
 *   <div class="model-preview toolpath-preview" aria-label="G-code toolpath">
 *     <p class="model-preview__empty">No toolpath</p>
 *   </div>
 *
 * API:
 *   const preview = initToolpathPreview(element);
 *   preview.setToolpath({ segments, layerCount, bounds, warnings });
 *   preview.setMaxLayer(3);
 *   preview.clear();
 */

import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { APP_CONFIG } from "../config.js";
import { setHidden } from "../utils/dom.js";

const DEFAULT_ARIA_LABEL = "G-code toolpath preview";
const MAX_PIXEL_RATIO = 2;
const EPSILON = 1e-5;

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

function fitCameraToObject(camera, controls, object) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) return;

  const distance =
    (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35);
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
  camera.updateProjectionMatrix();
}

/**
 * @param {HTMLElement} previewEl
 * @returns {{
 *   setToolpath: (toolpath: { segments: ArrayLike<unknown>, layerCount?: number }) => void,
 *   setMaxLayer: (layer: number | null) => void,
 *   clear: () => void,
 *   destroy: () => void,
 * } | null}
 */
export function initToolpathPreview(previewEl) {
  if (!(previewEl instanceof HTMLElement)) return null;
  if (!previewEl.classList.contains("toolpath-preview")) return null;
  if (previewEl.dataset.toolpathPreviewInit !== undefined) return null;

  previewEl.dataset.toolpathPreviewInit = "";
  const emptyEl = previewEl.querySelector(
    ".toolpath-preview__empty, .model-preview__empty"
  );
  const ariaLabel =
    previewEl.getAttribute("aria-label") || DEFAULT_ARIA_LABEL;

  let renderer;
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
  let extrusionLines = null;
  let travelLines = null;
  let segments = [];
  let maxLayer = null;
  let destroyed = false;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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

  function renderToolpath() {
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
    if (travelPositions.length) {
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
      fitCameraToObject(camera, controls, group);
      if (emptyEl) setHidden(emptyEl, true);
    } else if (emptyEl) {
      setHidden(emptyEl, false);
    }
    renderer.render(scene, camera);
  }

  function setToolpath(toolpath) {
    segments = readSegments(toolpath);
    renderToolpath();
  }

  function setMaxLayer(layer) {
    maxLayer =
      layer === null || layer === undefined
        ? null
        : Math.max(0, Math.floor(Number.isFinite(Number(layer)) ? Number(layer) : 0));
    renderToolpath();
  }

  function clear() {
    segments = [];
    disposeLines();
    if (emptyEl) setHidden(emptyEl, false);
    renderer.render(scene, camera);
  }

  function render() {
    if (destroyed) return;
    controls.update();
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
  renderer.render(scene, camera);
  requestAnimationFrame(render);

  return {
    setToolpath,
    setMaxLayer,
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
