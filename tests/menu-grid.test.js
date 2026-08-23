import test from "node:test";
import assert from "node:assert/strict";
import {
  DROPDOWN_GRID_DEFAULT_MIN,
  gridMenuIndexForKey,
  readListGridConfig,
  resolveListGridConfig,
  roundedUnionOutlinePath,
  syncDropdownMenuGrid,
  syncListGridSelectionJoins,
  syncPopupListGrid,
} from "../app/utils/menu.js";

test("readDropdownGridConfig defaults and disable", () => {
  assert.equal(DROPDOWN_GRID_DEFAULT_MIN, 6);

  const host = { dataset: {} };
  assert.deepEqual(readListGridConfig(null), {
    enabled: false,
    min: 6,
    cols: 2,
  });
  assert.deepEqual(readListGridConfig(host), {
    enabled: false,
    min: 6,
    cols: 2,
  });

  host.dataset.dropdownGrid = "";
  assert.deepEqual(readListGridConfig(host), {
    enabled: true,
    min: 6,
    cols: 2,
  });

  host.dataset.dropdownGrid = "8";
  assert.deepEqual(readListGridConfig(host), {
    enabled: true,
    min: 8,
    cols: 2,
  });

  host.dataset.dropdownGrid = "false";
  assert.deepEqual(readListGridConfig(host), {
    enabled: false,
    min: 6,
    cols: 2,
  });

  host.dataset.dropdownGridMin = "8";
  delete host.dataset.dropdownGrid;
  host.dataset.dropdownGridCols = "3";
  assert.deepEqual(readListGridConfig(host), {
    enabled: true,
    min: 8,
    cols: 3,
  });
});

test("resolveListGridConfig merges init options", () => {
  const host = { dataset: { dropdownGrid: "6" } };
  assert.deepEqual(resolveListGridConfig(host, { gridMin: 10 }), {
    enabled: true,
    min: 10,
    cols: 2,
  });
  assert.deepEqual(resolveListGridConfig(host, { gridMin: false }), {
    enabled: false,
    min: 6,
    cols: 2,
  });
  assert.deepEqual(resolveListGridConfig(host, { gridCols: 3 }), {
    enabled: true,
    min: 6,
    cols: 3,
  });
  assert.deepEqual(resolveListGridConfig(host, {}), {
    enabled: true,
    min: 6,
    cols: 2,
  });
});

test("syncPopupListGrid toggles combobox list class by visible item count", () => {
  const items = Array.from({ length: 7 }, () => ({
    disabled: false,
    classList: { remove: () => {} },
    closest: () => ({ hidden: false, classList: { contains: () => false } }),
  }));

  const listEl = {
    classList: {
      contains: (name) => name === "combobox-list" || name === "combobox-list--grid",
      toggle: (name, on) => {
        listEl.gridOn = on;
      },
      add: () => {},
      remove: () => {},
    },
    querySelector: () => null,
    children: [],
    querySelectorAll: () => items,
    style: {
      getPropertyValue: (name) => (name === "--dropdown-menu-grid-cols" ? listEl.cols ?? "" : ""),
      setProperty: (name, value) => {
        listEl.cols = value;
      },
      removeProperty: (name) => {
        if (name === "--dropdown-menu-grid-cols") listEl.cols = undefined;
      },
    },
    gridOn: false,
  };

  const config = { enabled: true, min: 6, cols: 2 };

  assert.equal(
    syncPopupListGrid(listEl, null, ".combobox-option", config),
    true
  );
  assert.equal(listEl.gridOn, true);

  items.pop();
  assert.equal(
    syncPopupListGrid(listEl, null, ".combobox-option", config),
    false
  );
});

test("readListGridConfig reads combobox dataset aliases", () => {
  assert.deepEqual(readListGridConfig({ dataset: { comboboxGrid: "8" } }), {
    enabled: true,
    min: 8,
    cols: 2,
  });
});

test("syncDropdownMenuGrid toggles class by item count", () => {
  const items = Array.from({ length: 7 }, () => ({
    disabled: false,
    classList: { remove: () => {} },
    closest: () => ({ hidden: false, classList: { contains: () => false } }),
  }));

  const menuEl = {
    classList: {
      contains: (name) => name === "dropdown-menu" || name === "dropdown-menu--grid",
      toggle: (name, on) => {
        menuEl.gridOn = on;
      },
      add: () => {},
      remove: () => {},
    },
    querySelector: () => null,
    children: [],
    querySelectorAll: () => items,
    style: {
      getPropertyValue: (name) => (name === "--dropdown-menu-grid-cols" ? menuEl.cols ?? "" : ""),
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

test("syncListGridSelectionJoins merges adjacent selected grid cells", () => {
  function makeItem(selected) {
    const classList = new Set(selected ? ["is-selected"] : []);
    return {
      disabled: false,
      classList: {
        contains: (name) => classList.has(name),
        add: (name) => classList.add(name),
        remove: (...names) => names.forEach((name) => classList.delete(name)),
      },
      getAttribute: () => null,
    };
  }

  const items = [makeItem(true), makeItem(true), makeItem(true), makeItem(false)];
  const rows = items.map((item) => ({
    hidden: false,
    classList: { contains: () => false },
    querySelector: (sel) => (sel === ".combobox-option" ? item : null),
  }));

  const listEl = {
    classList: {
      contains: (name) => name === "combobox-list--grid",
      add: () => {},
      remove: () => {},
    },
    querySelector: () => null,
    children: rows,
    style: {
      getPropertyValue: () => "2",
    },
    querySelectorAll: (sel) => (sel === ".combobox-option" ? items : []),
  };

  syncListGridSelectionJoins(listEl, ".combobox-option");

  assert.ok(items[0].classList.contains("is-selection-join-right"));
  assert.ok(items[0].classList.contains("is-selection-join-bottom"));
  assert.ok(items[0].classList.contains("is-selection-corner-tl"));
  assert.ok(items[1].classList.contains("is-selection-join-left"));
  assert.ok(items[1].classList.contains("is-selection-corner-tr"));
  assert.ok(items[1].classList.contains("is-selection-corner-br"));
  assert.ok(items[2].classList.contains("is-selection-join-top"));
  assert.ok(items[2].classList.contains("is-selection-corner-bl"));
  assert.ok(items[2].classList.contains("is-selection-corner-br"));
  assert.equal(items[3].classList.contains("is-selection-join-top"), false);
});

test("roundedUnionOutlinePath rounds convex and re-entrant corners of an L-shape", () => {
  const path = roundedUnionOutlinePath(
    [
      { x: 0, y: 0, width: 40, height: 24 },
      { x: 40, y: 0, width: 40, height: 24 },
      { x: 0, y: 24, width: 40, height: 24 },
    ],
    6
  );

  assert.match(path, /A 6 6 0 0 1 /);
  assert.match(path, /A 6 6 0 0 0 40 30/);
  assert.equal((path.match(/A 6 6 0 0 0 /g) || []).length, 1);
});

test("roundedUnionOutlinePath fillets both inner corners of a T-stub", () => {
  const path = roundedUnionOutlinePath(
    [
      { x: 0, y: 0, width: 40, height: 24 },
      { x: 0, y: 24, width: 40, height: 24 },
      { x: 40, y: 24, width: 40, height: 24 },
      { x: 0, y: 48, width: 40, height: 24 },
    ],
    6
  );

  assert.match(path, /A 6 6 0 0 0 46 24/);
  assert.match(path, /A 6 6 0 0 0 40 54/);
});