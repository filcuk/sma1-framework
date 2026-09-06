import test from "node:test";
import assert from "node:assert/strict";
import { resolvePopupFixedOptions } from "../app/utils/menu.js";

test("resolvePopupFixedOptions defaults to absolute start", () => {
  assert.deepEqual(resolvePopupFixedOptions(null), {
    fixed: false,
    fixedAlign: "start",
  });
});

test("resolvePopupFixedOptions reads data-dropdown-fixed markup", () => {
  const el = {
    dataset: { dropdownFixed: "", dropdownFixedAlign: "end" },
  };
  assert.deepEqual(resolvePopupFixedOptions(el), {
    fixed: true,
    fixedAlign: "end",
  });

  el.dataset.dropdownFixed = "false";
  assert.deepEqual(resolvePopupFixedOptions(el), {
    fixed: false,
    fixedAlign: "end",
  });
});

test("resolvePopupFixedOptions JS options override markup", () => {
  const el = {
    dataset: { dropdownFixed: "true", dropdownFixedAlign: "end" },
  };
  assert.deepEqual(resolvePopupFixedOptions(el, { fixed: false, fixedAlign: "start" }), {
    fixed: false,
    fixedAlign: "start",
  });
});
