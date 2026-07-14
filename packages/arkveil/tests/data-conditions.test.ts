import { describe, it, expect } from "vitest";
import {
  normalizeDatasetId,
  substituteIds,
  IDS_PLACEHOLDER,
} from "../src/data-conditions";

describe("normalizeDatasetId", () => {
  it("accepts a canonical three-segment id unchanged", () => {
    expect(normalizeDatasetId("billing.public.payments")).toBe(
      "billing.public.payments",
    );
  });

  it("normalizes case and surrounding whitespace the way the server does", () => {
    expect(normalizeDatasetId("  Billing.PUBLIC.Payments ")).toBe(
      "billing.public.payments",
    );
  });

  it("rejects the 2-segment pre-release shorthand", () => {
    expect(() => normalizeDatasetId("billing.payments")).toThrowError(
      "datasetId must have exactly 3 segments (datasource.schema.table): billing.payments",
    );
  });

  it("rejects a 4-segment (database) form", () => {
    expect(() => normalizeDatasetId("db.billing.public.payments")).toThrow();
  });

  it("rejects segments that are not identifiers", () => {
    expect(() => normalizeDatasetId("billing.public.9lives")).toThrow();
    expect(() => normalizeDatasetId("billing..payments")).toThrow();
    expect(() => normalizeDatasetId("billing.pub lic.payments")).toThrow();
    expect(() => normalizeDatasetId("")).toThrow();
  });
});

describe("substituteIds", () => {
  const template = `SELECT (NOT EXISTS (SELECT 1 FROM t WHERE "seq" IN (${IDS_PLACEHOLDER})))`;

  it("substitutes the placeholder with quoted SQL literals", () => {
    expect(substituteIds(template, ["42", "7"])).toBe(
      `SELECT (NOT EXISTS (SELECT 1 FROM t WHERE "seq" IN ('42', '7')))`,
    );
  });

  it("stringifies numbers and bigints", () => {
    expect(substituteIds(template, [42, 7n])).toContain(`IN ('42', '7')`);
  });

  it("escapes embedded single quotes", () => {
    expect(substituteIds(template, ["O'Brien"])).toContain(`IN ('O''Brien')`);
  });

  it("rejects an empty id list (an empty IN () is not valid SQL)", () => {
    expect(() => substituteIds(template, [])).toThrowError(/at least one id/);
  });

  it("rejects SQL without the placeholder (ids were already inlined)", () => {
    expect(() =>
      substituteIds(`SELECT (NOT EXISTS (SELECT 1 WHERE "seq" IN (42)))`, ["42"]),
    ).toThrowError(/no \{\{ids\}\} placeholder/);
  });
});
