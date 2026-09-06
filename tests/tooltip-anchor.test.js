import test from "node:test";
import assert from "node:assert/strict";
import { resolveTooltipAnchor } from "../app/components/tooltip.js";

test("resolveTooltipAnchor returns the content element when unset", () => {
  const el = { dataset: {} };
  assert.equal(resolveTooltipAnchor(/** @type {HTMLElement} */ (el)), el);
});

test("resolveTooltipAnchor returns the content element for invalid selectors", () => {
  const el = { dataset: { tooltipAnchor: ":::bad" } };
  assert.equal(resolveTooltipAnchor(/** @type {HTMLElement} */ (el)), el);
});
