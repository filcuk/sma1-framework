import test from "node:test";
import assert from "node:assert/strict";
import {
  DROPDOWN_GRID_DEFAULT_MIN,
  gridMenuIndexForKey,
  readDropdownGridConfig,
  resolveDropdownGridConfig,
  syncDropdownMenuGrid,
} from "../app/utils/menu.js";

test("readDropdownGridConfig defaults and disable", () => {
  assert.equal(DROPDOWN_GRID_DEFAULT_MIN, 6);

  const host = { dataset: {} };
  assert.deepEqual(readDropdownGridConfig(null), {
    enabled: false,
    min: 6,
    cols: 2,
  });
  assert.deepEqual(readDropdownGridConfig(host), {
    enabled: false,
    min: 6,
    cols: 2,
  });

  host.dataset.dropdownGrid = "";
  assert.deepEqual(readDropdownGridConfig(host), {
    enabled: true,
    min: 6,
    cols: 2,
  });

  host.dataset.dropdownGrid = "8";
  assert.deepEqual(readDropdownGridConfig(host), {
    enabled: true,
    min: 8,
    cols: 2,
  });

  host.dataset.dropdownGrid = "false";
  assert.deepEqual(readDropdownGridConfig(host), {
    enabled: false,
    min: 6,
    cols: 2,
  });

  host.dataset.dropdownGridMin = "8";
  delete host.dataset.dropdownGrid;
  host.dataset.dropdownGridCols = "3";
  assert.deepEqual(readDropdownGridConfig(host), {
    enabled: true,
    min: 8,
    cols: 3,
  });
});

test("resolveDropdownGridConfig merges init options", () => {
  const host = { dataset: { dropdownGrid: "6" } };
  assert.deepEqual(resolveDropdownGridConfig(host, { gridMin: 10 }), {
    enabled: true,
    min: 10,
    cols: 2,
  });
  assert.deepEqual(resolveDropdownGridConfig(host, { gridMin: false }), {
    enabled: false,
    min: 6,
    cols: 2,
  });
  assert.deepEqual(resolveDropdownGridConfig(host, { gridCols: 3 }), {
    enabled: true,
    min: 6,
    cols: 3,
  });
  assert.deepEqual(resolveDropdownGridConfig(host, {}), {
    enabled: true,
    min: 6,
    cols: 2,
  });
});

test("syncDropdownMenuGrid toggles class by item count", () => {
  const items = Array.from({ length: 7 }, () => ({ disabled: false }));

  const menuEl = {
    classList: {
      contains: (name) => name === "dropdown-menu",
      toggle: (name, on) => {
        menuEl.gridOn = on;
      },
    },
    querySelectorAll: () => items,
    style: {
      setProperty: (name, value) => {
        menuEl.cols = value;
      },
      removeProperty: (name) => {
        if (name === "--dropdown-menu-grid-cols") menuEl.cols = undefined;
      },
    },
    gridOn: false,
  };

  const config = { enabled: true, min: 6, cols: 2 };

  assert.equal(
    syncDropdownMenuGrid(menuEl, null, ".dropdown-menu-item", config),
    true
  );
  assert.equal(menuEl.gridOn, true);
  assert.equal(menuEl.cols, "2");

  items.pop();
  assert.equal(
    syncDropdownMenuGrid(menuEl, null, ".dropdown-menu-item", config),
    false
  );
  assert.equal(menuEl.gridOn, false);
  assert.equal(menuEl.cols, undefined);
});

test("gridMenuIndexForKey moves within columns", () => {
  const items = Array.from({ length: 8 }, (_, i) => i);
  assert.equal(gridMenuIndexForKey(items, 0, "ArrowRight", 2), 1);
  assert.equal(gridMenuIndexForKey(items, 1, "ArrowDown", 2), 3);
  assert.equal(gridMenuIndexForKey(items, 6, "ArrowUp", 2), 4);
  assert.equal(gridMenuIndexForKey(items, 7, "ArrowDown", 2), 7);
});
