# Admin Portal Modernization Roadmap

The admin portal works. This document is not about rewriting it — it is about
giving it the same safety net the client portal already has.

## Why

The client portal is TypeScript + Vite + Vitest with six test suites. The admin
portal, until this commit, had **no `package.json` at all**: no build step, no
lint, no type checking, no tests, no CI. Two files carry the whole product:

| File | Size |
| --- | --- |
| `app.js` | ~150 KB |
| `index.html` | ~75 KB |
| `styles.css` | ~58 KB |

The language is not the problem. Vanilla JS is a legitimate choice for a small
UI. The problem is that this UI stopped being small — it now carries RBAC, a
courier queue, SMS payment approval and team management — and nothing
mechanically checks it.

## The plan

### ✅ Step 1 — Tooling baseline (this PR)

Add `package.json`, ESLint 9 flat config, `tsconfig.json` (`allowJs: true`,
`checkJs: false`), Prettier and GitHub Actions CI.

**Zero changes to `app.js`, `index.html` or `styles.css`.** Runtime behaviour is
bit-for-bit identical. Every lint rule is `warn`, so this lands green.

The deliverable is a **number**: how many `no-unsanitized` warnings exist today.
That number is the honest answer to the AP-02 question that manual review could
not settle — a `grep` can only prove presence, never absence.

### Step 2 — Ratchet

Drive the baseline down and lock it in:

1. Run `npm run lint` and record the warning count.
2. Set `--max-warnings=<count>` in CI. New problems now fail the build.
3. Fix warnings in small PRs, lowering the number each time.
4. At zero for a given rule, promote it from `warn` to `error`.

Priority order: `no-unsanitized/property` → `no-undef` → `no-unused-vars`.

### Step 3 — Kill the inline handlers

This is the true blocker for everything after it, and the reason the admin CSP
still needs `script-src-attr 'unsafe-inline'`.

Handlers like `onclick="setTab('courierQueue')"` require `app.js` top-level
functions to be global. That in turn forces classic-script loading, which
forbids bundling, modules and per-file imports.

Approach: event delegation. One listener at the container, `data-action` and
`data-arg` attributes on the elements, a dispatch table in JS. Convert one tab
at a time; each conversion is independently shippable and independently
revertable.

When the last inline handler is gone:

- `script-src-attr 'none'` can move from report-only to enforced
- `sourceType` can become `"module"`
- Vite becomes possible

### Step 4 — TypeScript, file by file

Only after step 3. Split `app.js` into modules, then per module:

1. Add `// @ts-check` at the top
2. Fix what it reports (JSDoc types are enough at first — no rename needed)
3. Rename `.js` → `.ts` when the file is clean

When every file has `// @ts-check`, flipping `checkJs: true` is a no-op and the
comments can be deleted.

Do not attempt this as one big-bang conversion. The industry-standard advice is
a few files per sprint so feature work never stops.

## Cross-cutting: kill the type drift at the API boundary

Separate from the steps above, and applicable to **both** portals.

The backend is Python/FastAPI, the frontend is TS/JS. Hand-maintaining the
same shapes on both sides guarantees drift — that is exactly what audit finding
API-05 was (the analytics `overview` / `audience` / `signal-doctor` payload
mismatch, patched by hand in the client portal).

FastAPI already emits an OpenAPI schema. Generate the types instead:

```bash
npx openapi-typescript https://api.buykori.app/openapi.json -o src/types/api.d.ts
```

Run it in CI and fail on a dirty diff. Then a backend response change breaks the
frontend build immediately, instead of silently, in production, months later.
