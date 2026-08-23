import test from "node:test";
import assert from "node:assert/strict";

import { computePopoverPlacement } from "../app/components/popover.js";
import {
  clampTutorialIndex,
  describeTutorialTarget,
  formatTutorialMissingTargetMessage,
  normalizeTutorialSteps,
} from "../app/components/tutorial.js";

test("computePopoverPlacement centres without an anchor and hides the notch", () => {
  const placed = computePopoverPlacement({
    anchorRect: null,
    bubble: { width: 200, height: 100 },
    viewport: { width: 1000, height: 800 },
  });
  assert.equal(placed.side, null);
  assert.equal(placed.notchOffset, 0);
  assert.equal(placed.left, 400);
  assert.equal(placed.top, 350);
});

test("computePopoverPlacement prefers the requested side when there is room", () => {
  const placed = computePopoverPlacement({
    anchorRect: { top: 400, left: 400, width: 40, height: 20 },
    bubble: { width: 200, height: 80 },
    viewport: { width: 1000, height: 800 },
    position: "bottom",
    gap: 12,
    padding: 8,
  });
  assert.equal(placed.side, "bottom");
  assert.equal(placed.top, 432);
  assert.ok(placed.notchOffset > 0);
});

test("computePopoverPlacement flips when the requested side is too tight", () => {
  const placed = computePopoverPlacement({
    anchorRect: { top: 10, left: 400, width: 40, height: 20 },
    bubble: { width: 200, height: 80 },
    viewport: { width: 1000, height: 800 },
    position: "top",
    gap: 12,
    padding: 8,
  });
  assert.equal(placed.side, "bottom");
});

test("computePopoverPlacement clamps into the viewport and keeps the notch inset", () => {
  const placed = computePopoverPlacement({
    anchorRect: { top: 100, left: 5, width: 20, height: 20 },
    bubble: { width: 300, height: 100 },
    viewport: { width: 320, height: 400 },
    position: "bottom",
    gap: 8,
    notchSize: 12,
    padding: 8,
  });
  assert.equal(placed.left, 8);
  assert.ok(placed.notchOffset >= 12);
  assert.ok(placed.notchOffset <= 300 - 12);
});

test("computePopoverPlacement auto prefers bottom when it fits", () => {
  const placed = computePopoverPlacement({
    anchorRect: { top: 300, left: 300, width: 40, height: 20 },
    bubble: { width: 120, height: 60 },
    viewport: { width: 800, height: 600 },
    position: "auto",
    gap: 12,
    padding: 8,
  });
  assert.equal(placed.side, "bottom");
});

test("computePopoverPlacement auto falls back to a side that fits", () => {
  const placed = computePopoverPlacement({
    anchorRect: { top: 10, left: 10, width: 40, height: 20 },
    bubble: { width: 120, height: 200 },
    viewport: { width: 800, height: 240 },
    position: "auto",
    gap: 12,
    padding: 8,
  });
  /* Top/bottom are too tight for a 200px bubble; right still fits. */
  assert.equal(placed.side, "right");
});

test("clampTutorialIndex bounds and rejects empty scripts", () => {
  assert.equal(clampTutorialIndex(0, 0), -1);
  assert.equal(clampTutorialIndex(2, 3), 2);
  assert.equal(clampTutorialIndex(-4, 3), 0);
  assert.equal(clampTutorialIndex(99, 3), 2);
  assert.equal(clampTutorialIndex(1.9, 3), 1);
});

test("normalizeTutorialSteps fills defaults and accepts advanceOn click", () => {
  assert.deepEqual(normalizeTutorialSteps(null), []);
  assert.deepEqual(normalizeTutorialSteps(undefined), []);

  const [step] = normalizeTutorialSteps([
    {
      target: "#save",
      title: "Save",
      body: "Click save",
      interactive: true,
      advanceOn: "click",
      padding: 16,
    },
  ]);

  assert.equal(step.target, "#save");
  assert.equal(step.title, "Save");
  assert.equal(step.body, "Click save");
  assert.equal(step.position, "auto");
  assert.equal(step.interactive, true);
  assert.equal(step.advanceOn, "click");
  assert.equal(step.padding, 16);
  assert.equal(step.scroll, true);
});

test("describeTutorialTarget labels selectors, functions, and elements", () => {
  assert.equal(describeTutorialTarget("#save-btn"), "#save-btn");
  assert.equal(describeTutorialTarget(() => null), "[function target]");
  assert.equal(describeTutorialTarget(null), "(none)");

  const el = { tagName: "BUTTON", id: "save", getAttribute: () => null };
  assert.equal(describeTutorialTarget(el), "#save");
});

test("formatTutorialMissingTargetMessage describes skip, stop, and disconnect", () => {
  const step = { target: "#missing", title: "Save" };

  assert.match(
    formatTutorialMissingTargetMessage({
      id: "getting-started",
      index: 1,
      step,
      outcome: "skip-forward",
    }),
    /\[tutorial:getting-started\] Missing target for "Save" \(#missing\); skipping forward\./,
  );

  assert.match(
    formatTutorialMissingTargetMessage({
      id: "getting-started",
      index: 1,
      step,
      outcome: "stop",
    }),
    /no reachable step — stopping tour\./,
  );

  assert.match(
    formatTutorialMissingTargetMessage({
      id: "getting-started",
      index: 1,
      step,
      outcome: "disconnected",
    }),
    /is no longer in the document; advancing forward\./,
  );
});

test("normalizeTutorialSteps ignores unknown position and non-click advanceOn", () => {
  const [step] = normalizeTutorialSteps([
    { position: "sideways", advanceOn: "hover", scroll: false },
  ]);
  assert.equal(step.position, "auto");
  assert.equal(step.advanceOn, null);
  assert.equal(step.scroll, false);
  assert.equal(step.interactive, false);
  assert.equal(step.padding, null);
});
