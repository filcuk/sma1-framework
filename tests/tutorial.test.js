import test from "node:test";
import assert from "node:assert/strict";

import { computePopoverPlacement } from "../app/components/popover.js";
import {
  clampTutorialIndex,
  combineTutorialWhen,
  countEligibleTutorialSteps,
  describeTutorialTarget,
  eligibleTutorialOrdinal,
  findEligibleTutorialIndex,
  formatTutorialMissingTargetMessage,
  isTutorialStepEligible,
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
  assert.equal(step.when, undefined);
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

test("normalizeTutorialSteps flattens nested groups and ANDs inherited when", () => {
  let parent = true;
  let extra = true;
  const steps = normalizeTutorialSteps([
    { title: "Intro" },
    {
      when: () => parent,
      steps: [
        { title: "B1" },
        { title: "B2", when: () => extra },
      ],
    },
    { when: false, steps: [{ title: "Never" }] },
    { title: "Outro" },
  ]);

  assert.equal(steps.length, 5);
  assert.equal(steps[0].title, "Intro");
  assert.equal(steps[0].when, undefined);
  assert.equal(steps[1].title, "B1");
  assert.equal(typeof steps[1].when, "function");
  assert.equal(steps[2].title, "B2");
  assert.equal(steps[3].title, "Never");
  assert.equal(steps[3].when, false);
  assert.equal(steps[4].title, "Outro");
  assert.equal(isTutorialStepEligible(steps[3], { index: 3, step: steps[3] }), false);

  assert.equal(isTutorialStepEligible(steps[1], { index: 1, step: steps[1] }), true);
  extra = false;
  assert.equal(isTutorialStepEligible(steps[2], { index: 2, step: steps[2] }), false);
  parent = false;
  extra = true;
  assert.equal(isTutorialStepEligible(steps[1], { index: 1, step: steps[1] }), false);
  assert.equal(isTutorialStepEligible(steps[2], { index: 2, step: steps[2] }), false);
});

test("isTutorialStepEligible treats boolean when and thrown when", () => {
  assert.equal(isTutorialStepEligible({ when: true }), true);
  assert.equal(isTutorialStepEligible({ when: false }), false);
  assert.equal(isTutorialStepEligible({ when: () => 0 }), false);
  assert.equal(isTutorialStepEligible({ when: () => "yes" }), true);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    assert.equal(
      isTutorialStepEligible({
        when: () => {
          throw new Error("boom");
        },
      }),
      false,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
});

test("findEligibleTutorialIndex skips ineligible steps and does not clamp", () => {
  const steps = normalizeTutorialSteps([
    { title: "A" },
    { title: "B", when: false },
    { title: "C", when: () => true },
    { title: "D", when: false },
  ]);

  assert.equal(findEligibleTutorialIndex(steps, 0, "forward"), 0);
  assert.equal(findEligibleTutorialIndex(steps, 1, "forward"), 2);
  assert.equal(findEligibleTutorialIndex(steps, 3, "forward"), -1);
  assert.equal(findEligibleTutorialIndex(steps, 3, "backward"), 2);
  assert.equal(findEligibleTutorialIndex(steps, 0, "backward"), 0);
  assert.equal(findEligibleTutorialIndex(steps, -1, "forward"), -1);
  assert.equal(findEligibleTutorialIndex(steps, 4, "forward"), -1);
});

test("eligible step counts and ordinals ignore the skipped branch", () => {
  const steps = normalizeTutorialSteps([
    { title: "Intro" },
    { title: "A", when: () => false },
    { title: "B", when: () => true },
    { title: "Outro" },
  ]);

  assert.equal(countEligibleTutorialSteps(steps), 3);
  assert.equal(eligibleTutorialOrdinal(steps, 0), 0);
  assert.equal(eligibleTutorialOrdinal(steps, 1), -1);
  assert.equal(eligibleTutorialOrdinal(steps, 2), 1);
  assert.equal(eligibleTutorialOrdinal(steps, 3), 2);
});

test("combineTutorialWhen ANDs parent and child conditions", () => {
  const child = () => true;
  assert.equal(combineTutorialWhen(undefined, child), child);
  assert.equal(combineTutorialWhen(true, child), child);
  assert.equal(combineTutorialWhen(false, child), false);
  assert.equal(combineTutorialWhen(child, undefined), child);

  const combined = combineTutorialWhen(
    () => true,
    () => false,
  );
  assert.equal(typeof combined, "function");
  assert.equal(combined({ index: 0, step: {} }), false);
});
