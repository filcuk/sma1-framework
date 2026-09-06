import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateRules,
  getValidator,
  parseValidateList,
  registerValidator,
} from "../app/utils/field-validation.js";

/** @type {import("../app/utils/field-validation.js").FieldValidationContext} */
const ctx = { field: /** @type {HTMLElement} */ ({}), control: null };

describe("parseValidateList", () => {
  it("splits pipe-separated rule ids", () => {
    assert.deepEqual(parseValidateList("email|noSpaces|alphanumeric"), [
      "email",
      "noSpaces",
      "alphanumeric",
    ]);
  });

  it("trims and drops empties", () => {
    assert.deepEqual(parseValidateList(" email | | number "), ["email", "number"]);
  });
});

describe("built-in validators", () => {
  it("email requires @", () => {
    assert.equal(evaluateRules("a@b", ["email"], ctx).valid, true);
    assert.equal(evaluateRules("missing", ["email"], ctx).valid, false);
    assert.equal(evaluateRules("", ["email"], ctx).valid, true);
  });

  it("number accepts finite values and min/max", () => {
    assert.equal(evaluateRules("3.5", ["number"], ctx).valid, true);
    assert.equal(evaluateRules("nope", ["number"], ctx).valid, false);
    assert.equal(
      evaluateRules("2", ["number"], { ...ctx, min: 5, max: 10 }).valid,
      false
    );
    assert.equal(
      evaluateRules("7", ["number"], { ...ctx, min: 5, max: 10 }).valid,
      true
    );
    assert.match(
      evaluateRules("12", ["number"], { ...ctx, min: 5, max: 10 }).message,
      /between/
    );
  });

  it("noSpaces rejects whitespace", () => {
    assert.equal(evaluateRules("ok", ["noSpaces"], ctx).valid, true);
    assert.equal(evaluateRules("not ok", ["noSpaces"], ctx).valid, false);
  });

  it("alphanumeric allows only ASCII letters and digits", () => {
    assert.equal(evaluateRules("Ab12", ["alphanumeric"], ctx).valid, true);
    assert.equal(evaluateRules("Ab-12", ["alphanumeric"], ctx).valid, false);
  });

  it("required rejects empty", () => {
    assert.equal(evaluateRules("", ["required"], ctx).valid, false);
    assert.equal(evaluateRules("  ", ["required"], ctx).valid, false);
    assert.equal(evaluateRules("x", ["required"], ctx).valid, true);
  });

  it("empty optional skips format rules", () => {
    assert.equal(
      evaluateRules("", ["email", "alphanumeric", "number"], ctx).valid,
      true
    );
  });

  it("composes required then format", () => {
    assert.equal(evaluateRules("", ["required", "email"], ctx).valid, false);
    assert.equal(evaluateRules("nope", ["required", "email"], ctx).valid, false);
    assert.equal(evaluateRules("a@b", ["required", "email"], ctx).valid, true);
  });
});

describe("custom validators", () => {
  it("registerValidator adds a named rule", () => {
    registerValidator("endsWithCom", (value) =>
      value.endsWith(".com") ? true : "Must end with .com"
    );
    assert.ok(getValidator("endsWithCom"));
    assert.equal(evaluateRules("a@b.org", ["endsWithCom"], ctx).valid, false);
    assert.equal(
      evaluateRules("a@b.com", ["endsWithCom"], ctx).message,
      ""
    );
    assert.equal(evaluateRules("a@b.com", ["endsWithCom"], ctx).valid, true);
  });

  it("accepts inline function rules", () => {
    const result = evaluateRules("sku-1", [
      (value) => (value.startsWith("sku-") ? true : "SKU prefix required"),
    ], ctx);
    assert.equal(result.valid, true);

    const bad = evaluateRules("x", [
      (value) => (value.startsWith("sku-") ? true : "SKU prefix required"),
    ], ctx);
    assert.equal(bad.valid, false);
    assert.equal(bad.message, "SKU prefix required");
  });
});
