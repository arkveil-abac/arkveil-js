import { describe, it, expect } from "vitest";
import {
  applyWriteChecksContract,
  normalizeDatasetCode,
  prepareWriteChecksIds,
  resolveCreateResultSql,
  substituteIds,
  CONTRACT_VIOLATION,
  DENY_SQL,
  IDS_PLACEHOLDER,
  METADATA_MISSING,
} from "../src/data-conditions";

describe("normalizeDatasetCode", () => {
  it("accepts a canonical three-segment id unchanged", () => {
    expect(normalizeDatasetCode("billing.public.payments")).toBe(
      "billing.public.payments",
    );
  });

  it("normalizes case and surrounding whitespace the way the server does", () => {
    expect(normalizeDatasetCode("  Billing.PUBLIC.Payments ")).toBe(
      "billing.public.payments",
    );
  });

  it("rejects the 2-segment pre-release shorthand", () => {
    expect(() => normalizeDatasetCode("billing.payments")).toThrowError(
      "datasetCode must have exactly 3 segments (datasource.schema.table): billing.payments",
    );
  });

  it("rejects a 4-segment (database) form", () => {
    expect(() => normalizeDatasetCode("db.billing.public.payments")).toThrow();
  });

  it("rejects segments that are not identifiers", () => {
    expect(() => normalizeDatasetCode("billing.public.9lives")).toThrow();
    expect(() => normalizeDatasetCode("billing..payments")).toThrow();
    expect(() => normalizeDatasetCode("billing.pub lic.payments")).toThrow();
    expect(() => normalizeDatasetCode("")).toThrow();
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
      substituteIds(`SELECT (NOT EXISTS (SELECT 1 WHERE "seq" IN (42)))`, [
        "42",
      ]),
    ).toThrowError(/no \{\{ids\}\} placeholder/);
  });
});

describe("resolveCreateResultSql", () => {
  const template = `SELECT (NOT EXISTS (SELECT 1 FROM t WHERE "id" IN (${IDS_PLACEHOLDER}) AND amount > 100))`;

  it("fills the template with the ids the insert produced", () => {
    expect(resolveCreateResultSql({ resultSql: template }, [7, "8"])).toBe(
      `SELECT (NOT EXISTS (SELECT 1 FROM t WHERE "id" IN ('7', '8') AND amount > 100))`,
    );
  });

  it("denies when the response carries no resultSql", () => {
    expect(resolveCreateResultSql({}, ["7"])).toBe(DENY_SQL);
  });

  it("denies a resultSql with no template (fail-closed or unregistered dataset)", () => {
    expect(resolveCreateResultSql({ resultSql: DENY_SQL }, ["7"])).toBe(
      DENY_SQL,
    );
  });

  it("rejects an empty id list — an insert of no rows has nothing to authorize", () => {
    expect(() => resolveCreateResultSql({ resultSql: template }, [])).toThrow(
      /at least one inserted row/,
    );
  });
});

describe("prepareWriteChecksIds", () => {
  it("stringifies ids for UPDATE and DELETE", () => {
    expect(prepareWriteChecksIds("UPDATE", [42, "7", 10n])).toEqual([
      "42",
      "7",
      "10",
    ]);
    expect(prepareWriteChecksIds("DELETE", ["a"])).toEqual(["a"]);
  });

  it("returns no ids for CREATE", () => {
    expect(prepareWriteChecksIds("CREATE", undefined)).toBeUndefined();
  });

  it("rejects the shapes the server answers 400 to", () => {
    expect(() => prepareWriteChecksIds("CREATE", ["7"])).toThrow(
      /must not be sent with CREATE/,
    );
    expect(() => prepareWriteChecksIds("UPDATE", undefined)).toThrow(
      /ids are required for UPDATE/,
    );
    expect(() =>
      prepareWriteChecksIds("READ" as unknown as "UPDATE", ["7"]),
    ).toThrow(/operation must be one of/);
  });

  it("passes an empty list through for the caller to treat as a no-op", () => {
    expect(prepareWriteChecksIds("DELETE", [])).toEqual([]);
  });
});

describe("applyWriteChecksContract", () => {
  const CREATE_RESULT = `SELECT ok(${IDS_PLACEHOLDER})`;

  it("keeps a well-formed response for each operation", () => {
    expect(
      applyWriteChecksContract("CREATE", {
        resultSql: CREATE_RESULT,
        mode: "NORMAL",
      }),
    ).toEqual({ response: { resultSql: CREATE_RESULT, mode: "NORMAL" } });
    expect(
      applyWriteChecksContract("UPDATE", {
        touchSql: "SELECT a()",
        resultSql: "SELECT b()",
        mode: "NORMAL",
      }).violation,
    ).toBeUndefined();
    expect(
      applyWriteChecksContract("DELETE", {
        touchSql: "SELECT a()",
        mode: "NORMAL",
      }).violation,
    ).toBeUndefined();
  });

  it("denies whole when a required field is missing", () => {
    const { response, violation } = applyWriteChecksContract("UPDATE", {
      touchSql: "SELECT a()",
      mode: "NORMAL",
    });

    expect(response).toEqual({
      touchSql: DENY_SQL,
      resultSql: DENY_SQL,
      mode: "NORMAL",
      reason: CONTRACT_VIOLATION,
    });
    expect(violation).toMatch(/missing resultSql/);
  });

  it("denies a template where the ids should have been inlined", () => {
    const { response, violation } = applyWriteChecksContract("DELETE", {
      touchSql: `SELECT a(${IDS_PLACEHOLDER})`,
      mode: "NORMAL",
    });

    expect(response.touchSql).toBe(DENY_SQL);
    expect(response.reason).toBe(CONTRACT_VIOLATION);
    expect(violation).toMatch(/inlined server-side/);
  });

  it("denies a CREATE whose resultSql has no template to fill", () => {
    const { response, violation } = applyWriteChecksContract("CREATE", {
      resultSql: "SELECT TRUE",
      mode: "NORMAL",
    });

    expect(response.resultSql).toBe(DENY_SQL);
    expect(violation).toMatch(/no \{\{ids\}\} template/);
  });

  it("accepts an unregistered dataset's plain SELECT FALSE as the deny it is", () => {
    const response = {
      resultSql: DENY_SQL,
      mode: "NORMAL",
      reason: METADATA_MISSING,
    };

    expect(applyWriteChecksContract("CREATE", response)).toEqual({ response });
  });

  it("drops a phase the operation does not have", () => {
    const { response, violation } = applyWriteChecksContract("DELETE", {
      touchSql: "SELECT a()",
      resultSql: "SELECT b()",
      mode: "NORMAL",
    });

    expect(response).toEqual({ touchSql: "SELECT a()", mode: "NORMAL" });
    expect(violation).toMatch(/no phase for/);
  });
});
