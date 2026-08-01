# Admin Portal Modernization Roadmap

The admin portal works. This document is not about rewriting it — it is about
giving it the same safety net the client portal already has.

## Why

The client portal is TypeScript + Vite + Vitest with six test suites. The admin
portal, until this commit, had **no `package.json` at all**: no build step, no
lint, no type checking, no tests, no CI. Two files carry the whole product:

| File         | Size    |
| ------------ | ------- |
| `app.js`     | ~150 KB |
| `index.html` | ~75 KB  |
| `styles.css` | ~58 KB  |

The language is not the problem. Vanilla JS is a legitimate choice for a small
UI. The problem is that this UI stopped being small — it now carries RBAC, a
courier queue, SMS payment approval and team management — and nothing
mechanically checks it.

## The plan

### ✅ Step 1 — Tooling baseline (this PR)

Add `package.json`, ESLint 9 flat config, `tsconfig.json` (`allowJs: true`,
`checkJs: false`), Prettier and GitHub Actions CI.

**Zero changes to `app.js`, `index.html` or `styles.css`.** Runtime behaviour is
bit-for-bit identical. The measured legacy baseline is 94 warnings, and
`--max-warnings=94` keeps this PR green while making any new warning fail CI.

The baseline is **94 warnings**: 36 `no-unsanitized/property`, 54
`no-unused-vars`, two `prefer-const`, and two `no-useless-escape`. That is the
honest answer to the AP-02 question that manual review could not settle — a
`grep` can only prove presence, never absence.

### ✅ Step 2 — Ratchet baseline

Drive the baseline down and lock it in:

The initial count was 94. The completed action-migration slices lowered the
current lock to 85. Next:

1. Fix warnings in small PRs, lowering `--max-warnings` each time.
2. At zero for a given rule, promote it from `warn` to `error`.

Priority order: `no-unsanitized/property` → `no-undef` → `no-unused-vars`.

### Step 3 — Kill the inline handlers (in progress)

Native event attributes are gone and the enforced CSP now uses
`script-src-attr 'none'`. The temporary `data-admin-*` bridge still stores
JavaScript-like expressions and resolves their functions through `window`, so
classic-script loading is still required and modules remain blocked.

Approach: event delegation. One listener at the container, `data-action` and
`data-arg` attributes on the elements, a dispatch table in JS. Convert one tab
at a time; each conversion is independently shippable and independently
revertable.

Progress:

- Dashboard: migrated to named `data-action` entries and an explicit dispatch
  table. Its static and runtime templates no longer use the temporary
  `data-admin-*` expression bridge.
- Courier Queue: migrated refresh, auto-refresh, job details, retry and drawer
  close behavior. The direct `retryButton.onclick` assignment is gone, and the
  lint ratchet moved to 88 warnings.
- Clients directory: migrated Add Client navigation, Manage and
  Activate/Deactivate. Its offline flow also caught and removed a stale
  `getAttribute("onclick")` dependency in modal tab selection. The lint ratchet
  moved to 87 warnings.
- Create Client: migrated to a named submit action with required-field
  validation, double-submit protection, trimmed payloads, secret-field reset
  and explicit API-error feedback. The lint ratchet is now 85 warnings.

When the last inline handler is gone:

- the temporary expression parser and global-function allowlist can be deleted
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
