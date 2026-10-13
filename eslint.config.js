import { scopelockBase } from "./packages/config/eslint.base.js";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "data/**", "playwright-report/**", "test-results/**"] },
  ...scopelockBase,
];
