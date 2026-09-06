import * as THREE from "../vendor/three/three.module.min.js";

const SETTLE_POS = 1e-4;
const SETTLE_ANGLE = 1e-3;
const SETTLE_RADIUS = 1e-3;
const MIN_RADIUS = 1e-4;

/**
 * @typedef {{
 *   position: THREE.Vector3,
 *   target: THREE.Vector3,
 *   near: number,
 *   far: number,
 *   minDistance: number,
 *   maxDistance: number,
 * }} OrbitFitPose
 *
 * @typedef {{
 *   position: THREE.Vector3,
 *   target: THREE.Vector3,
 *   spherical: THREE.Spherical,
 *   near: number,
 *   far: number,
 *   minDistance: number,
 *   maxDistance: number,
 *   _offset: THREE.Vector3,
 *   _spherical: THREE.Spherical,
 * }} OrbitHomeAnim
 */

/**
 * Build a home animation that interpolates in spherical orbit space
 * (radius / theta / phi + look-at target). Cartesian lerp of camera.position
 * and target passes near the look-at point mid-flight and looks like a huge zoom.
 *
 * @param {OrbitFitPose} pose
 * @returns {OrbitHomeAnim}
 */
export function createOrbitHomeAnim(pose) {
  const offset = new THREE.Vector3().subVectors(pose.position, pose.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.makeSafe();
  if (spherical.radius < MIN_RADIUS) spherical.radius = MIN_RADIUS;

  return {
    position: pose.position.clone(),
    target: pose.target.clone(),
    spherical,
    near: pose.near,
    far: pose.far,
    minDistance: pose.minDistance,
    maxDistance: pose.maxDistance,
    _offset: new THREE.Vector3(),
    _spherical: new THREE.Spherical(),
  };
}

/**
 * @param {number} from
 * @param {number} to
 */
function shortestAngleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Advance one damping step toward the home orbit pose.
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Vector3} controlsTarget
 * @param {OrbitHomeAnim} homeAnim
 * @param {number} factor OrbitControls-style damping factor (e.g. 0.08)
 * @returns {boolean} `true` while the animation should continue
 */
export function tickOrbitHomeAnim(camera, controlsTarget, homeAnim, factor) {
  const current = homeAnim._spherical.setFromVector3(
    homeAnim._offset.subVectors(camera.position, controlsTarget)
  );
  current.makeSafe();
  if (current.radius < MIN_RADIUS) current.radius = MIN_RADIUS;

  const goal = homeAnim.spherical;
  current.theta += shortestAngleDelta(current.theta, goal.theta) * factor;
  current.phi += (goal.phi - current.phi) * factor;
  current.radius += (goal.radius - current.radius) * factor;
  current.makeSafe();
  if (current.radius < MIN_RADIUS) current.radius = MIN_RADIUS;

  controlsTarget.lerp(homeAnim.target, factor);
  camera.position.copy(controlsTarget).add(homeAnim._offset.setFromSpherical(current));

  const remaining = homeAnim._spherical.setFromVector3(
    homeAnim._offset.subVectors(camera.position, controlsTarget)
  );
  remaining.makeSafe();

  const done =
    controlsTarget.distanceToSquared(homeAnim.target) < SETTLE_POS &&
    Math.abs(remaining.radius - goal.radius) < SETTLE_RADIUS &&
    Math.abs(remaining.phi - goal.phi) < SETTLE_ANGLE &&
    Math.abs(shortestAngleDelta(remaining.theta, goal.theta)) < SETTLE_ANGLE;

  if (!done) return true;

  controlsTarget.copy(homeAnim.target);
  camera.position.copy(homeAnim.position);
  return false;
}
