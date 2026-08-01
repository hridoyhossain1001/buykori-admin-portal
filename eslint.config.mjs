// Flat ESLint config for the Buykori admin portal.
//
// STEP 1 of the TypeScript migration: tooling only, zero runtime changes.
//
// Every rule below is "warn" on purpose. The point of step 1 is to establish a
// baseline warning count without failing the build or forcing a giant refactor.
// Ratchet rules to "error" one at a time, only after that rule's count is zero.

import js from "@eslint/js";
import globals from "globals";
import nounsanitized from "eslint-plugin-no-unsanitized";

export default [
  {
    ignores: ["node_modules/**", "dist/**", ".vercel/**", "public/vendor/**"],
  },

  js.configs.recommended,

  {
    // Only the deployed browser scripts are classic scripts. This config file
    // is an ES module and must keep ESLint's default `sourceType: "module"`.
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,

      // ---------------------------------------------------------------------
      // DO NOT change this to "module" without reading this comment first.
      //
      // index.html loads the app with a classic script tag:
      //     <script src="app.js"></script>
      //
      // There is no type="module". That is load-bearing: index.html and the
      // HTML that app.js generates are full of inline handlers such as
      //     onclick="loadAll({ refreshDashboard: true })"
      //     onclick="setTab('courierQueue')"
      //     onclick="decideSmsPayment(123, 'approve')"
      // Those only resolve because app.js's top-level functions land on
      // `window`. ES modules have their own scope, so flipping this flag (or
      // bundling app.js through Vite) would make every inline handler throw
      // "x is not defined" and silently disable most of the admin UI.
      //
      // Migrating inline handlers to addEventListener is STEP 3. See
      // MIGRATION.md.
      // ---------------------------------------------------------------------
      sourceType: "script",

      globals: {
        ...globals.browser,
        // Loaded from cdn.jsdelivr.net in index.html
        QRCode: "readonly",
      },
    },

    plugins: {
      "no-unsanitized": nounsanitized,
    },

    rules: {
      // --- The reason this config exists -----------------------------------
      // Flags innerHTML / outerHTML / insertAdjacentHTML / document.write with
      // non-literal input. This is the automated version of the manual XSS
      // escaping review (AP-02). The esc() helper in app.js is correct; what
      // was never verifiable by hand is whether EVERY sink goes through it.
      // This rule answers that question mechanically.
      "no-unsanitized/property": "warn",
      "no-unsanitized/method": "warn",

      // --- Correctness ------------------------------------------------------
      "no-undef": "warn",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-useless-escape": "warn",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // --- Prep work for the eventual TypeScript move -----------------------
      eqeqeq: ["warn", "smart"],
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },

  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
