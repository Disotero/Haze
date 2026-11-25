// `npm run lint`. Main process and preload are CommonJS on Node/Electron;
// renderer pages are ES modules in the browser, talking to main only
// through `window.cozy` (preload.js). The rules catch bugs, not style.
import js from "@eslint/js";
import globals from "globals";
import nounsanitized from "eslint-plugin-no-unsanitized";

export default [
  { ignores: ["dist/**", "node_modules/**", ".backup/**", ".playwright-cli/**"] },
  js.configs.recommended,
  {
    files: ["src/main/**/*.js", "src/preload.js", "test/**/*.js"],
    languageOptions: { sourceType: "commonjs", ecmaVersion: 2025, globals: { ...globals.node } },
  },
  {
    files: ["src/renderer/**/*.js"],
    languageOptions: { sourceType: "module", ecmaVersion: 2025, globals: { ...globals.browser } },
    plugins: { "no-unsanitized": nounsanitized },
    rules: {
      // Pages build markup from strings a lot; anything interpolated must
      // go through esc() (or be our own constant markup). Flagged as
      // warnings so each spot gets a look, not as errors that block a build.
      "no-unsanitized/property": "warn",
      "no-unsanitized/method": "warn",
    },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `(a, b)` sequences in arrow bodies are used on purpose here.
      "no-sequences": "off",
      "no-control-regex": "off",
    },
  },
];
