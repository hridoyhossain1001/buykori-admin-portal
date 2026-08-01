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
    // The main app is deployed as an ES module. theme-init.js gets a classic
    // script override below because it must run synchronously before paint.
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,

      sourceType: "module",

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
    files: ["theme-init.js"],
    languageOptions: {
      sourceType: "script",
    },
  },

  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
