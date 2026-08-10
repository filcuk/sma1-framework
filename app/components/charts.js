/**
 * Charts — thin host around vendored TanStack Charts (`mountChart`).
 *
 * Import ESM modules from `app/vendor/tanstack-charts/` (relative paths), e.g.:
 *   ../vendor/tanstack-charts/dom.js
 *   ../vendor/tanstack-charts/scene.js
 *   ../vendor/tanstack-charts/bar.js
 *   ../vendor/tanstack-charts/tooltip.js
 *   ../vendor/tanstack-charts/scales/band.js
 *   ../vendor/tanstack-charts/scales/linear.js
 *
 * Prefer narrow entry files over the root barrel (`index.js`) so unused marks
 * stay out of the module graph.
 *
 * Pages that use marks which bare-import `d3-scale` (including `barY` / `barX`)
 * must include an import map before any `type="module"` script:
 *   { "imports": { "d3-scale": "./app/vendor/d3-scale/d3-scale.esm.js" } }
 *
 * Refresh vendor (maintainer):
 *   1. `npm pack @tanstack/charts@0.9.0` — copy `package/dist/*.js` and
 *      `package/dist/scales/*.js` into `app/vendor/tanstack-charts/` (omit
 *      framework adapter folders and `.d.ts`).
 *   2. Download the self-contained bundle
 *      `https://esm.sh/d3-scale@4.0.2/es2022/d3-scale.bundle.mjs` as
 *      `app/vendor/d3-scale/d3-scale.esm.js` (pinned with D3_SCALE_VERSION).
 */

/** @type {const} */
export const TANSTACK_CHARTS_VERSION = "0.9.0";

/** @type {const} */
export const D3_SCALE_VERSION = "4.0.2";

// initChart / initCharts land in the next implementation step.
