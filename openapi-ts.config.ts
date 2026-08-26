import { defineConfig } from "@hey-api/openapi-ts";

/*
 * Generates types and Zod validators from openapi.yaml. The output is
 * committed and CI-verified clean, so the contract and the code enforcing it
 * cannot drift. Never hand-edit anything under src/generated.
 *
 * The @hey-api/sdk and client plugins are deliberately not enabled: their HTTP
 * runtime does not satisfy exactOptionalPropertyTypes, and weakening that flag
 * across the whole codebase to accommodate a generated fetch wrapper is a bad
 * trade. Types plus Zod give full request and response safety; callers use
 * fetch directly. Re-enable by adding "@hey-api/client-fetch" and
 * "@hey-api/sdk" here and relaxing that compiler option.
 */
export default defineConfig({
  input: "./openapi.yaml",
  output: {
    path: "./src/generated",
    postProcess: ["prettier"],
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      enums: "javascript",
    },
    {
      name: "zod",
      compatibilityVersion: 4,
      // Requests validate inbound payloads in route handlers; responses let
      // withContract() (#12) catch a handler drifting from the spec.
      requests: true,
      responses: true,
      definitions: true,
    },
  ],
});
