/**
 * Types and helpers for the data-protection (row-level security) endpoints:
 * `POST /api/{version}/abac/conditions/read` and `/write`.
 *
 * The SDK's data-related job is to obtain SQL enforcement artifacts from
 * Arkveil and hand them to the application to apply to its own queries. The
 * SDK never receives policies — only rendered SQL (PostgreSQL-flavored today).
 * Both endpoints share the base URL and `X-Api-Key` auth with
 * `checkPermission`, and are served identically by the Arkveil kernel and a
 * customer-run `arkveil-runtime` sidecar — the base URL is opaque config.
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

/**
 * The literal placeholder present in `writeSql` when the request omitted
 * `ids` — substitute it with {@link substituteIds} before executing.
 */
export const IDS_PLACEHOLDER = "{{ids}}";

/**
 * The `reason` value marking a fail-closed response for a well-formed dataset
 * id that is not registered in Arkveil. It means "deny, and tell the
 * operator": the write is blocked by a configuration gap (the dataset isn't
 * defined in Studio), not by policy. Surface it distinctly from an ordinary
 * policy deny.
 */
export const METADATA_MISSING = "METADATA_MISSING";

/**
 * The client-synthesized `mode` returned when a conditions request could not
 * be completed (network failure, timeout, non-OK response) and the SDK failed
 * closed. Never sent by the server. Like any non-`"NORMAL"` mode it should be
 * treated as degraded: honor the SQL, flag the call in diagnostics.
 */
export const MODE_UNAVAILABLE = "UNAVAILABLE";

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
}

export interface WriteChecksRequest<
  TUser extends Record<string, any> = Record<string, any>,
  TContext extends Record<string, any> = Record<string, any>,
> {
  /** `datasource.schema.table` — normalized (trim + lowercase) before sending. */
  datasetCode: string;
  user: TUser;
  context: TContext;
  /**
   * Primary-key values of the rows the mutation touches (the just-inserted
   * ids for the after-CREATE check; the targeted ids for UPDATE/DELETE).
   * Values are sent as strings; the server casts them using the dataset's
   * declared primary-key type and rejects values that don't fit it (400).
   * When omitted, `writeSql` comes back with the `{{ids}}` placeholder to
   * substitute via {@link substituteIds}.
   */
  ids?: readonly WriteCheckId[];
}

export interface WriteChecksResponse {
  /**
   * A single statement returning one boolean: `true` ⇒ the mutation touches
   * no forbidden row. Execute it against the application's database inside
   * the mutation's transaction and roll back on `false`. When it runs is part
   * of the contract: after the insert for CREATE, before AND after for
   * UPDATE, before for DELETE. Rows that don't exist are not a violation —
   * the check evaluates only rows it finds.
   */
  writeSql: string;
  /**
   * Always `[]` today (INVARIANT policies are authorable but not evaluated).
   * When evaluation lands, each entry will be a statement that must hold
   * after the mutation.
   */
  invariantSql: string[];
  /** See {@link ReadConditionResponse.mode}. */
  mode: string;
  /**
   * Set on fail-closed responses; `"METADATA_MISSING"` (see
   * {@link METADATA_MISSING}) means the dataset isn't registered in Arkveil.
   */
  reason?: string;
}

/**
 * Substitute the `{{ids}}` placeholder in a `writeSql` template with the
 * given primary-key values, rendered as properly escaped SQL string literals
 * (PostgreSQL coerces them to the column's type).
 *
 * @throws Error when `ids` is empty (an `IN ()` list is not valid SQL — with
 *   no rows touched there is nothing to check) or when the SQL contains no
 *   placeholder (the ids were already inlined server-side).
 */
export function substituteIds(
  writeSql: string,
  ids: readonly WriteCheckId[],
): string {
  if (ids.length === 0) {
    throw new Error(
      "substituteIds requires at least one id — with no rows touched there is nothing to check.",
    );
  }
  if (!writeSql.includes(IDS_PLACEHOLDER)) {
    throw new Error(
      `writeSql contains no ${IDS_PLACEHOLDER} placeholder — it is only present when the request omitted ids.`,
    );
  }
  const literals = ids
    .map((id) => `'${String(id).replaceAll("'", "''")}'`)
    .join(", ");
  return writeSql.replaceAll(IDS_PLACEHOLDER, literals);
}
