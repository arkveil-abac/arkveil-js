import { describe, it, expect, vi, afterEach } from "vitest";
import { Arkveil } from "../src/arkveil";
import { MODE_NO_OP, resolveCreateResultSql } from "../src/data-conditions";

/**
 * The mutation recipes an application follows with the artifacts the SDK
 * hands it: which check runs when, and what a `false` costs. The SDK never
 * touches the application's database, so the database here is a fake that
 * records the statements it was asked to run.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient() {
  return new Arkveil({
    serviceUrl: "http://api.test",
    apiKey: "test-key",
    retryAttempts: 1,
  });
}

/** A transaction that records statements and answers checks from `verdicts`. */
class FakeTx {
  public readonly statements: string[] = [];
  public rolledBack = false;
  public committed = false;

  constructor(
    private readonly verdicts: (sql: string) => boolean = () => true,
  ) {}

  async check(sql: string): Promise<boolean> {
    this.statements.push(sql);
    return this.verdicts(sql);
  }

  async run(sql: string): Promise<string[]> {
    this.statements.push(sql);
    return [];
  }

  rollback(): "rolled back" {
    this.rolledBack = true;
    return "rolled back";
  }

  commit(): "committed" {
    this.committed = true;
    return "committed";
  }
}

const DATASET = "billing.public.payments";
const USER = { id: "u1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("named-rows recipes", () => {
  it("CREATE: insert, then fill the {{ids}} template with the inserted ids and check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          resultSql: `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ({{ids}}) AND amount > 100)`,
          mode: "NORMAL",
        }),
      ),
    );
    const tx = new FakeTx();

    const checks = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "CREATE",
    });

    await tx.run("INSERT INTO payments (amount) VALUES (50) RETURNING id");
    const insertedIds = [7, 8];
    const allowed = await tx.check(resolveCreateResultSql(checks, insertedIds));
    allowed ? tx.commit() : tx.rollback();

    expect(tx.statements).toEqual([
      "INSERT INTO payments (amount) VALUES (50) RETURNING id",
      `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ('7', '8') AND amount > 100)`,
    ]);
    expect(tx.committed).toBe(true);
  });

  it("CREATE: a false post-state check rolls the insert back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          resultSql: `SELECT check_result({{ids}})`,
          mode: "NORMAL",
        }),
      ),
    );
    const tx = new FakeTx(() => false);

    const checks = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "CREATE",
    });
    await tx.run("INSERT INTO payments (amount) VALUES (5000)");
    const allowed = await tx.check(resolveCreateResultSql(checks, ["7"]));
    if (!allowed) tx.rollback();

    expect(tx.rolledBack).toBe(true);
  });

  it("CREATE: a fail-closed response yields a check that cannot pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const checks = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "CREATE",
    });

    expect(resolveCreateResultSql(checks, ["7"])).toBe("SELECT FALSE");
  });

  it("UPDATE: pre-state check, mutation, post-state check — in that order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          touchSql: "SELECT touch_ok()",
          resultSql: "SELECT result_ok()",
          mode: "NORMAL",
        }),
      ),
    );
    const tx = new FakeTx();

    const { touchSql, resultSql } = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
      ids: [42],
    });

    if (await tx.check(touchSql!)) {
      await tx.run("UPDATE payments SET amount = 10 WHERE id = 42");
      (await tx.check(resultSql!)) ? tx.commit() : tx.rollback();
    }

    expect(tx.statements).toEqual([
      "SELECT touch_ok()",
      "UPDATE payments SET amount = 10 WHERE id = 42",
      "SELECT result_ok()",
    ]);
    expect(tx.committed).toBe(true);
  });

  it("UPDATE: a false pre-state check stops the mutation from running at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          touchSql: "SELECT touch_ok()",
          resultSql: "SELECT result_ok()",
          mode: "NORMAL",
        }),
      ),
    );
    const tx = new FakeTx((sql) => sql !== "SELECT touch_ok()");

    const { touchSql } = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
      ids: [42],
    });
    if (!(await tx.check(touchSql!))) tx.rollback();

    expect(tx.statements).toEqual(["SELECT touch_ok()"]);
    expect(tx.rolledBack).toBe(true);
  });

  it("UPDATE: a false post-state check rolls the applied mutation back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          touchSql: "SELECT touch_ok()",
          resultSql: "SELECT result_ok()",
          mode: "NORMAL",
        }),
      ),
    );
    const tx = new FakeTx((sql) => sql !== "SELECT result_ok()");

    const { touchSql, resultSql } = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
      ids: [42],
    });
    if (await tx.check(touchSql!)) {
      await tx.run("UPDATE payments SET amount = 10 WHERE id = 42");
      if (!(await tx.check(resultSql!))) tx.rollback();
    }

    expect(tx.statements).toHaveLength(3);
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
  });

  it("DELETE: the pre-state check is the whole of it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ touchSql: "SELECT touch_ok()", mode: "NORMAL" }),
      ),
    );
    const tx = new FakeTx();

    const checks = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "DELETE",
      ids: [42],
    });
    if (await tx.check(checks.touchSql!)) {
      await tx.run("DELETE FROM payments WHERE id = 42");
      tx.commit();
    }

    expect(checks.resultSql).toBeUndefined();
    expect(tx.statements).toEqual([
      "SELECT touch_ok()",
      "DELETE FROM payments WHERE id = 42",
    ]);
  });

  it("a mutation targeting no rows runs no request and no checks", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tx = new FakeTx();

    const checks = await makeClient().buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "DELETE",
      ids: [],
    });

    expect(checks.mode).toBe(MODE_NO_OP);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tx.statements).toEqual([]);
  });
});

describe("bulk recipes (conditions/touch)", () => {
  it("DELETE: composing the touch condition into WHERE is the whole recipe", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({ touchCondition: `"p"."owner_id" = 'u1'`, mode: "NORMAL" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tx = new FakeTx();

    const { touchCondition } = await makeClient().buildTouchCondition({
      datasetCode: DATASET,
      user: USER,
      context: {},
      alias: "p",
      operation: "DELETE",
    });
    await tx.run(
      `DELETE FROM payments p WHERE p.status = 'draft' AND (${touchCondition})`,
    );
    tx.commit();

    expect(tx.statements).toEqual([
      `DELETE FROM payments p WHERE p.status = 'draft' AND ("p"."owner_id" = 'u1')`,
    ]);
    // One request: a delete has no result phase to ask about.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://api.test/api/v1/abac/conditions/touch",
    );
  });

  it("UPDATE: compose, RETURNING ids, then run the post-state check only", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/touch")
        ? jsonResponse({
            touchCondition: `"p"."owner_id" = 'u1'`,
            mode: "NORMAL",
          })
        : jsonResponse({
            touchSql: "SELECT touch_ok()",
            resultSql: "SELECT result_ok()",
            mode: "NORMAL",
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tx = new FakeTx();
    const arkveil = makeClient();

    const { touchCondition } = await arkveil.buildTouchCondition({
      datasetCode: DATASET,
      user: USER,
      context: {},
      alias: "p",
      operation: "UPDATE",
    });
    await tx.run(
      `UPDATE payments p SET amount = 10 WHERE p.status = 'draft' AND (${touchCondition}) RETURNING p.id`,
    );
    const updatedIds = ["42", "43"];
    const { resultSql } = await arkveil.buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
      ids: updatedIds,
    });
    (await tx.check(resultSql!)) ? tx.commit() : tx.rollback();

    // The pre-state check is never run post-hoc: the state it judges is gone.
    expect(tx.statements).toEqual([
      `UPDATE payments p SET amount = 10 WHERE p.status = 'draft' AND ("p"."owner_id" = 'u1') RETURNING p.id`,
      "SELECT result_ok()",
    ]);
    expect(tx.statements).not.toContain("SELECT touch_ok()");
    expect(tx.committed).toBe(true);
  });

  it("UPDATE: a false post-state check rolls the whole bulk update back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/touch")
          ? jsonResponse({ touchCondition: "TRUE", mode: "NORMAL" })
          : jsonResponse({
              touchSql: "SELECT touch_ok()",
              resultSql: "SELECT result_ok()",
              mode: "NORMAL",
            }),
      ),
    );
    const tx = new FakeTx(() => false);
    const arkveil = makeClient();

    const { touchCondition } = await arkveil.buildTouchCondition({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
    });
    await tx.run(`UPDATE payments SET amount = 10 WHERE (${touchCondition})`);
    const { resultSql } = await arkveil.buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
      ids: ["42"],
    });
    if (!(await tx.check(resultSql!))) tx.rollback();

    expect(tx.rolledBack).toBe(true);
  });

  it("UPDATE: an empty RETURNING set asks for no checks at all", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ touchCondition: "FALSE", mode: "NORMAL" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tx = new FakeTx();
    const arkveil = makeClient();

    const { touchCondition } = await arkveil.buildTouchCondition({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
    });
    // An empty touch union renders FALSE: the statement affects zero rows.
    await tx.run(
      `UPDATE payments SET amount = 10 WHERE (${touchCondition}) RETURNING id`,
    );
    const updatedIds: string[] = [];
    const checks = await arkveil.buildWriteChecks({
      datasetCode: DATASET,
      user: USER,
      context: {},
      operation: "UPDATE",
      ids: updatedIds,
    });
    tx.commit();

    expect(checks.mode).toBe(MODE_NO_OP);
    expect(checks.resultSql).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // touch only
    expect(tx.statements).toEqual([
      "UPDATE payments SET amount = 10 WHERE (FALSE) RETURNING id",
    ]);
  });
});
