import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decimalPlaceholder,
  formatFixedDecimals,
} from "../app/utils/input-affix.js";

describe("formatFixedDecimals", () => {
  it("formats finite numbers to fixed places", () => {
    assert.equal(formatFixedDecimals("12", 2), "12.00");
    assert.equal(formatFixedDecimals("12.5", 2), "12.50");
    assert.equal(formatFixedDecimals("12.567", 2), "12.57");
    assert.equal(formatFixedDecimals("3", 0), "3");
  });

  it("returns null for empty or non-numeric values", () => {
    assert.equal(formatFixedDecimals(""), null);
    assert.equal(formatFixedDecimals("  "), null);
    assert.equal(formatFixedDecimals("nope", 2), null);
  });
});

describe("decimalPlaceholder", () => {
  it("builds a zero placeholder for the fraction length", () => {
    assert.equal(decimalPlaceholder(2), "0.00");
    assert.equal(decimalPlaceholder(0), "0");
    assert.equal(decimalPlaceholder(3), "0.000");
  });
});
