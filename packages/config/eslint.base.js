// Shared ESLint flat-config base for the ScopeLock monorepo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export const scopelockBase = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
];
