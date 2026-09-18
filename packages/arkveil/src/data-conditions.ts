/**
 * Types and helpers for the data-protection (row-level security) endpoints:
 * `POST /api/{version}/abac/conditions/read`, `/write`, and `/touch`.
 *
 * The SDK's data-related job is to obtain SQL enforcement artifacts from
 * Arkveil and hand them to the application to apply to its own queries. The
 * SDK never receives policies — only rendered SQL (PostgreSQL-flavored today).
 * All endpoints share the base URL and `X-Api-Key` auth with
 * `checkPermission`, and are served identically by the Arkveil kernel and a
 * customer-run `arkveil-runtime` sidecar — the base URL is opaque config.
 *
 * The data-policy model behind them is READ / TOUCH / RESULT:
 *
 * | Type   | Governs                                    | Judged                                  |
 * | ------ | ------------------------------------------ | --------------------------------------- |
 * | READ   | which rows a user sees                     | at read time                            |
 * | TOUCH  | which existing rows a mutation may touch   | before the mutation, on current state   |
 * | RESULT | the state a mutation may leave rows in     | after the mutation, same transaction    |
 *
 * TOUCH governs `UPDATE`/`DELETE`, RESULT governs `CREATE`/`UPDATE`. Each
 * operation has its own union of grants; a mutation whose union has no
 * applicable policy is denied whole.
 */

/**
 * A dataset code is exactly three dot-separated identifier segments,
 * lowercase: `datasource.schema.table`. There is no 2-segment shorthand and
 * no 4-segment (database) form — the schema segment is always explicit. (A
 * bare-table-name shorthand exists in the policy-authoring DSL, but that is
 * session-authed management surface — the SDK never accepts or emits it.)
 */
const DATASET_CODE_SEGMENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Normalize a dataset code the way the server does before lookup — trim +
 * lowercase — so the SDK's own cache keys and logs agree with what the
 * server matches on, and validate its shape.
 *
 * @throws Error when the code is not three dot-separated identifier segments
 *   (mirrors the server's 400). This signals a programming/configuration
 *   error, unlike transport failures, which the request methods absorb
 *   fail-closed.
 */
export function normalizeDatasetCode(datasetCode: string): string {
  const normalized = datasetCode.trim().toLowerCase();
  const segments = normalized.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !DATASET_CODE_SEGMENT.test(segment))
  ) {
    throw new Error(
      `datasetCode must have exactly 3 segments (datasource.schema.table): ${datasetCode}`,
    );
  }
  return normalized;
}

/**
 * Primary-key values identifying the rows a mutation touches. Sent to the
 * server as strings regardless of the input type — the server casts them
 * using the dataset's declared primary-key type.
 */
export type WriteCheckId = string | number | bigint;

/** The mutation a write check is asked about. `READ` is not one of them. */
export type WriteOperation = "CREATE" | "UPDATE" | "DELETE";

/**
 * The mutations that have a pre-state (TOUCH) phase, and therefore a touch
 * condition to compose into a bulk statement's WHERE clause. `CREATE` has no
 * WHERE clause and is rejected by the server (400).
 */
export type TouchOperation = Extract<WriteOperation, "UPDATE" | "DELETE">;

const WRITE_OPERATIONS: readonly WriteOperation[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
];
const TOUCH_OPERATIONS: readonly TouchOperation[] = ["UPDATE", "DELETE"];

/**
 * The literal placeholder present in a CREATE `resultSql` — the only response
 * that carries one, because the ids of the inserted rows exist only after the
 * insert and so cannot be inlined server-side. Substitute it with
 * {@link substituteIds} (or {@link resolveCreateResultSql}) before executing.
 * `UPDATE`/`DELETE` checks are rendered over the ids sent in the request, so
 * a placeholder in one of those is a contract violation.
 */
export const IDS_PLACEHOLDER = "{{ids}}";

/**
 * The statement the SDK substitutes whenever it must deny: a single boolean
 * `false`, shaped like any other check so callers execute one code path.
 */
export const DENY_SQL = "SELECT FALSE";

/** The condition the SDK substitutes when a read/touch condition must deny. */
export const DENY_CONDITION = "FALSE";

/**
 * The `reason` value marking a fail-closed response for a well-formed dataset
 * id that is not registered in Arkveil. It means "deny, and tell the
 * operator": the write is blocked by a configuration gap (the dataset isn't
 * defined in Studio), not by policy. Surface it distinctly from an ordinary
 * policy deny.
 */
export const METADATA_MISSING = "METADATA_MISSING";

/**
 * The server-set `reason` marking an evaluation that read a payload value of
 * the wrong type for its attribute schema — `"u-42"` where `user.id` is a
 * `uuid`, `"abc"` where the schema says `integer`. The engine evaluated that
 * value as absent and the SQL stands as returned: it may still admit rows, so
 * this is not a synonym for a deny and never widens or narrows what the
 * server sent. Fix the payload or the schema, not the policy. A missing key or
 * a JSON `null` is an optional attribute and carries no reason.
 */
export const ATTRIBUTE_INCOMPATIBLE = "ATTRIBUTE_INCOMPATIBLE";

/**
 * The client-synthesized `reason` marking a response that did not satisfy the
 * contract for the operation asked about — a required field is missing, or an
 * `{{ids}}` template turned up where the ids were supposed to be inlined.
 * The SDK denies rather than proceeding unchecked, and logs it distinctly:
 * like {@link METADATA_MISSING} it names a defect to fix, not a policy deny.
 */
export const CONTRACT_VIOLATION = "CONTRACT_VIOLATION";

/**
 * The client-synthesized `mode` returned when a conditions request could not
 * be completed (network failure, timeout, non-OK response) and the SDK failed
 * closed. Never sent by the server. Like any non-`"NORMAL"` mode it should be
 * treated as degraded: honor the SQL, flag the call in diagnostics.
 */
export const MODE_UNAVAILABLE = "UNAVAILABLE";

/**
 * The client-synthesized `mode` returned when a mutation targets no rows at
 * all (an empty `ids` list). There is nothing to authorize, so the SDK skips
 * the request entirely and returns no SQL — run no checks and no mutation.
 * Never sent by the server.
 */
export const MODE_NO_OP = "NO_OP";

export interface ReadConditionRequest<
  TUser extends Record<string, any> = Record<string, any>,
  TContext extends Record<string, any> = Record<string, any>,
> {
  /** `datasource.schema.table` — normalized (trim + lowercase) before sending. */
  datasetCode: string;
  user: TUser;
  context: TContext;
  /**
   * Table alias used in the protected query. Pass it whenever the protected
   * table is aliased or joined; columns in the condition are then qualified
   * `"alias"."column"` instead of `"schema"."table"."column"`.
   */
  alias?: string | null;
}

export interface ReadConditionResponse {
  /**
   * One SQL boolean expression to AND into the query's WHERE clause.
   * `FALSE` is a normal response meaning "no applicable policy ⇒ no rows" —
   * apply it like any other condition; never fall back to unfiltered access.
   */
  readCondition: string;
  /**
   * `"NORMAL"` unless the serving side is degraded. Treat unknown values as
   * degraded: honor the SQL, flag the call in diagnostics.
   */
  mode: string;
  /**
   * Why the answer is not an ordinary policy result. Set by the server —
   * {@link METADATA_MISSING} on a fail-closed response, {@link ATTRIBUTE_INCOMPATIBLE}
   * next to a condition that may well admit rows — or by the SDK
   * ({@link CONTRACT_VIOLATION}). Apply the condition as returned either way.
   */
  reason?: string;
}

export interface TouchConditionRequest<
  TUser extends Record<string, any> = Record<string, any>,
  TContext extends Record<string, any> = Record<string, any>,
> {
  /** `datasource.schema.table` — normalized (trim + lowercase) before sending. */
  datasetCode: string;
  user: TUser;
  context: TContext;
  /** See {@link ReadConditionRequest.alias}. */
  alias?: string | null;
  /**
   * The bulk mutation being composed. `CREATE` has no WHERE clause to compose
   * into and is rejected client-side (the server answers 400).
   */
  operation: TouchOperation;
}

export interface TouchConditionResponse {
  /**
   * A bare SQL boolean expression over the operation's TOUCH union, aliased
   * like a read condition — AND it into the bulk statement's WHERE clause.
   * Rows outside the subject's touch union are simply not touched; that
   * narrowing is deliberate and visible in the query. `FALSE` is a normal
   * response (empty union ⇒ zero rows affected), not an error.
   */
  touchCondition: string;
  /** See {@link ReadConditionResponse.mode}. */
  mode: string;
  /** See {@link ReadConditionResponse.reason}. */
  reason?: string;
}

export interface WriteChecksRequest<
  TUser extends Record<string, any> = Record<string, any>,
  TContext extends Record<string, any> = Record<string, any>,
> {
  /** `datasource.schema.table` — normalized (trim + lowercase) before sending. */
  datasetCode: string;
  user: TUser;
  context: TContext;
  /** The mutation the checks are about. Required; `READ` is not valid. */
  operation: WriteOperation;
  /**
   * Primary-key values of the rows the mutation targets. **Required and
   * non-empty for `UPDATE` and `DELETE`** — the checks answer about named
   * rows, inlined server-side as typed literals — and **absent for `CREATE`**,
   * whose ids do not exist until after the insert. Values are sent as
   * strings; the server casts them using the dataset's declared primary-key
   * type and rejects values that don't fit it (400).
   *
   * An empty list is a no-op, not a request: nothing is targeted, so there is
   * nothing to authorize (see {@link MODE_NO_OP}).
   */
  ids?: readonly WriteCheckId[];
}

export interface WriteChecksResponse {
  /**
   * The **pre-state** check: a single statement returning one boolean —
   * `true` ⇒ every targeted row is inside the subject's TOUCH union. Present
   * for `UPDATE` and `DELETE`, absent for `CREATE`. Run it **before** the
   * mutation statement, inside its transaction, and roll back on `false`.
   *
   * Never run it after the fact — for a bulk update composed with
   * {@link TouchConditionResponse.touchCondition}, the pre-state it checks no
   * longer exists and it would deny legitimate updates.
   */
  touchSql?: string;
  /**
   * The **post-state** check: a single statement returning one boolean —
   * `true` ⇒ the state the mutation left the rows in is inside the subject's
   * RESULT union. Present for `CREATE` and `UPDATE`, absent for `DELETE`. Run
   * it **after** the mutation statement, in the same transaction, and roll
   * back on `false`. On `CREATE` it carries the {@link IDS_PLACEHOLDER}
   * template — fill it with the inserted rows' ids via
   * {@link resolveCreateResultSql}.
   */
  resultSql?: string;
  /** See {@link ReadConditionResponse.mode}. */
  mode: string;
  /** See {@link ReadConditionResponse.reason}. */
  reason?: string;
}

/**
 * Validate that the request the caller is about to make is well-formed, and
 * render `ids` for the wire.
 *
 * @throws Error on the shapes the server answers 400 to — an unknown or
 *   missing `operation`, `ids` sent with `CREATE`, `ids` missing for
 *   `UPDATE`/`DELETE`. These are programming errors, not runtime conditions,
 *   so they surface loudly instead of being absorbed fail-closed. (No write
 *   proceeds either way: the caller never receives a check to pass.)
 */
export function prepareWriteChecksIds(
  operation: WriteOperation,
  ids: readonly WriteCheckId[] | undefined,
): string[] | undefined {
  if (!WRITE_OPERATIONS.includes(operation)) {
    throw new Error(
      `operation must be one of ${WRITE_OPERATIONS.join(", ")}: ${String(operation)}`,
    );
  }
  if (operation === "CREATE") {
    if (ids !== undefined) {
      throw new Error(
        "ids must not be sent with CREATE — the inserted rows' ids exist only after the insert; " +
          "substitute them into resultSql with resolveCreateResultSql instead.",
      );
    }
    return undefined;
  }
  if (ids === undefined) {
    throw new Error(
      `ids are required for ${operation} — the checks are rendered over the named rows.`,
    );
  }
  return ids.map((id) => String(id));
}

/** @throws Error when `operation` is not one a touch condition exists for. */
export function assertTouchOperation(
  operation: TouchOperation,
): TouchOperation {
  if (!TOUCH_OPERATIONS.includes(operation)) {
    throw new Error(
      `operation must be one of ${TOUCH_OPERATIONS.join(", ")}: ${String(operation)}`,
    );
  }
  return operation;
}

/** The deny-everything response for an operation, shaped with the fields that
 * operation has. */
export function denyWriteChecks(
  operation: WriteOperation,
  mode: string,
  reason?: string,
): WriteChecksResponse {
  return {
    ...(operation !== "CREATE" ? { touchSql: DENY_SQL } : {}),
    ...(operation !== "DELETE" ? { resultSql: DENY_SQL } : {}),
    mode,
    ...(reason !== undefined ? { reason } : {}),
  };
}

/**
 * Hold the response to the contract for the operation asked about. A field
 * the operation requires that is missing is a **contract violation — deny**,
 * never proceed unchecked; absent fields mean "this operation has no such
 * phase" only where the timing table says so. An `{{ids}}` template is
 * expected on `CREATE`'s `resultSql` and nowhere else.
 *
 * @returns the response to hand back, and the violation to log (if any).
 */
export function applyWriteChecksContract(
  operation: WriteOperation,
  response: WriteChecksResponse,
): { response: WriteChecksResponse; violation?: string } {
  const expectsTouch = operation !== "CREATE";
  const expectsResult = operation !== "DELETE";
  const missing: string[] = [];
  if (expectsTouch && typeof response.touchSql !== "string") {
    missing.push("touchSql");
  }
  if (expectsResult && typeof response.resultSql !== "string") {
    missing.push("resultSql");
  }
  if (missing.length > 0) {
    return {
      response: denyWriteChecks(
        operation,
        response.mode ?? MODE_UNAVAILABLE,
        CONTRACT_VIOLATION,
      ),
      violation: `${operation} response is missing ${missing.join(" and ")}`,
    };
  }

  // A dataset that isn't registered denies with SELECT FALSE in every field
  // the operation has — a documented deny, not a malformed template.
  if (response.reason !== METADATA_MISSING) {
    const templated: string[] = [];
    if (expectsTouch && response.touchSql!.includes(IDS_PLACEHOLDER)) {
      templated.push("touchSql");
    }
    if (
      operation !== "CREATE" &&
      expectsResult &&
      response.resultSql!.includes(IDS_PLACEHOLDER)
    ) {
      templated.push("resultSql");
    }
    if (templated.length > 0) {
      return {
        response: denyWriteChecks(
          operation,
          response.mode ?? MODE_UNAVAILABLE,
          CONTRACT_VIOLATION,
        ),
        violation:
          `${operation} response carries an ${IDS_PLACEHOLDER} template in ` +
          `${templated.join(" and ")}; ids are inlined server-side for this operation`,
      };
    }
    if (
      operation === "CREATE" &&
      !response.resultSql!.includes(IDS_PLACEHOLDER)
    ) {
      return {
        response: denyWriteChecks(
          operation,
          response.mode ?? MODE_UNAVAILABLE,
          CONTRACT_VIOLATION,
        ),
        violation: `CREATE resultSql carries no ${IDS_PLACEHOLDER} template to fill with the inserted rows' ids`,
      };
    }
  }

  // Unexpected phases are dropped rather than handed to the caller: running a
  // check the operation has no phase for is exactly the v1 conflation this
  // contract removed. Everything else passes through (additive contract).
  const unexpected: string[] = [];
  if (!expectsTouch && response.touchSql !== undefined)
    unexpected.push("touchSql");
  if (!expectsResult && response.resultSql !== undefined) {
    unexpected.push("resultSql");
  }
  if (unexpected.length === 0) return { response };

  const trimmed = { ...response };
  if (!expectsTouch) delete trimmed.touchSql;
  if (!expectsResult) delete trimmed.resultSql;
  return {
    response: trimmed,
    violation: `${operation} response carries ${unexpected.join(" and ")}, which this operation has no phase for; ignoring it`,
  };
}

/**
 * Substitute the `{{ids}}` placeholder in a SQL template with the given
 * primary-key values, rendered as properly escaped SQL string literals
 * (PostgreSQL coerces them to the column's type).
 *
 * Only a `CREATE` `resultSql` carries the template — see
 * {@link resolveCreateResultSql}, which applies this helper and handles the
 * deny cases. `UPDATE`/`DELETE` checks arrive with their ids already inlined.
 *
 * @throws Error when `ids` is empty (an `IN ()` list is not valid SQL — with
 *   no rows touched there is nothing to check) or when the SQL contains no
 *   placeholder.
 */
export function substituteIds(
  sql: string,
  ids: readonly WriteCheckId[],
): string {
  if (ids.length === 0) {
    throw new Error(
      "substituteIds requires at least one id — with no rows touched there is nothing to check.",
    );
  }
  if (!sql.includes(IDS_PLACEHOLDER)) {
    throw new Error(
      `sql contains no ${IDS_PLACEHOLDER} placeholder — it is only present on a CREATE resultSql.`,
    );
  }
  const literals = ids
    .map((id) => `'${String(id).replaceAll("'", "''")}'`)
    .join(", ");
  return sql.replaceAll(IDS_PLACEHOLDER, literals);
}

/**
 * Complete the CREATE path: take the ids of the rows the insert produced and
 * render the executable post-state check from the response's `resultSql`
 * template. Run the result in the insert's transaction and roll back on
 * `false`.
 *
 * Denies (returns {@link DENY_SQL}) whenever the response cannot be completed
 * — no `resultSql` at all, or one with no template (an unregistered dataset,
 * a fail-closed response, or a contract violation, each already logged by
 * `buildWriteChecks`). Fail-closed: never return SQL that would pass.
 *
 * @throws Error when `insertedIds` is empty — an insert that produced no rows
 *   has nothing to authorize; skip the check instead of calling this.
 */
export function resolveCreateResultSql(
  response: Pick<WriteChecksResponse, "resultSql">,
  insertedIds: readonly WriteCheckId[],
): string {
  if (insertedIds.length === 0) {
    throw new Error(
      "resolveCreateResultSql requires the ids of at least one inserted row — " +
        "an insert that produced no rows has nothing to authorize.",
    );
  }
  const { resultSql } = response;
  if (typeof resultSql !== "string" || !resultSql.includes(IDS_PLACEHOLDER)) {
    return DENY_SQL;
  }
  return substituteIds(resultSql, insertedIds);
}
