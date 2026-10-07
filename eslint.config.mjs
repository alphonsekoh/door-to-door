import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Generated from openapi.yaml (#11) - never hand-edited, so never linted.
    "src/generated/**",
    "drizzle/**",
  ]),

  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // `type` over `interface`: the OpenAPI codegen (#11) emits type aliases, and
      // interfaces allow declaration merging, which silently widens a contract type.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // Unused args are allowed only when explicitly marked with a leading underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Type-only imports keep the runtime bundle honest about what it actually needs.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unnecessary-condition": "error",
      // Floating promises in route handlers silently swallow failures.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/require-await": "error",
    },
  },

  // Playwright fixtures receive a callback conventionally named `use`, which the
  // React plugin mistakes for the `use` hook. There is no React here at all.
  {
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },

  // Config files run in Node and sit outside the app's type-checked program.
  {
    files: ["*.mjs", "*.ts", "*.config.*"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Must stay last so formatting rules lose to Prettier.
  prettier,
]);

export default eslintConfig;
