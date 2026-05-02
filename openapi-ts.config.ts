import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Codegen config for the AxonPush TypeScript SDK.
 *
 * Driven by `bun run codegen` which boots/asserts the backend on
 * :3000, dumps the spec to spec/openapi.json, runs the patcher, and
 * then invokes openapi-ts against this config.
 */
export default defineConfig({
  input: "./spec/openapi.json",
  output: {
    path: "./src/_internal/api",
    format: "biome",
    lint: false,
  },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    {
      name: "@hey-api/client-fetch",
      runtimeConfigPath: "./src/_internal/transport.ts",
    },
  ],
});
