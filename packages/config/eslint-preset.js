// Shared ESLint flat-config preset. The root eslint.config.js applies it to the whole repo.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Base rules for every TypeScript package. */
export const base = tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  languageOptions: { ecmaVersion: 2023, sourceType: "module" },
  rules: {
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  },
});

/** Node code: apps/api, scripts, config files. */
export const node = [{ languageOptions: { globals: { ...globals.node } } }];

/** Browser React code: apps/web. */
export const react = [
  reactHooks.configs.flat["recommended-latest"],
  reactRefresh.configs.vite,
  { languageOptions: { globals: { ...globals.browser } } },
];

/** packages/rules: pure and deterministic. No clock, no randomness, no I/O, no imports from outside the package. */
export const rulesPurity = [
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.{1,2}/)",
              message: "packages/rules imports only its own modules (zero runtime dependencies).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: "No clock in the rules core: take the time as input.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "No clock in the rules core: take the time as input.",
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "No randomness in the rules core: use the seeded PRNG.",
        },
      ],
      "no-restricted-globals": [
        "error",
        "process",
        "window",
        "document",
        "fetch",
        "localStorage",
        "setTimeout",
        "setInterval",
      ],
    },
  },
];

/** Last: turns off rules that Prettier owns. */
export const formatting = [prettier];
