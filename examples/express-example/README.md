# express-example

Reference app showing the `@arkveil/node` middleware with typed permission codes
(`arkveil.generated.ts`). It also doubles as a compile-time check that unknown
codes / attributes are rejected (see the `@ts-expect-error` lines in `index.ts`).

Install from the repo root (pnpm workspace):

```bash
pnpm install
```

Typecheck:

```bash
pnpm --filter express-example exec tsc --noEmit
```

Run (Node has no built-in TS runner here; use tsx):

```bash
pnpm dlx tsx index.ts   # serves on http://localhost:3005
```
