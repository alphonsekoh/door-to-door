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

  /*
   * Runtime configuration is read on the server only. A client component or a
   * framework-free helper importing the loader would drag node:fs and the
   * file's contents toward the browser bundle.
   */
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: ["src/lib/config.ts", "src/lib/config.test.ts", "src/lib/openapi-document.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "yaml",
              message: "Parse YAML in src/lib/config.ts or on the server, not in UI or helpers.",
            },
          ],
          patterns: [
            {
              group: ["@/server/config", "**/server/config"],
              message: "The config loader is server-only; do not import it from UI or helpers.",
            },
            {
              group: ["@/lib/config", "**/lib/config"],
              message: "Only server code may import the config schema.",
            },
            {
              group: ["@/auth", "@/auth/*"],
              message: "Auth.js and Google sign-in are server-only; pass what UI needs as props.",
            },
            // The same folder by a relative path. A regex, because a glob such as
            // "**/auth/*" would also catch "@/server/auth/routes", which UI may use.
            {
              regex: "^(?:\\.\\./)+(?:src/)?auth(?:/|$)",
              message: "Auth.js and Google sign-in are server-only; pass what UI needs as props.",
            },
          ],
        },
      ],
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
