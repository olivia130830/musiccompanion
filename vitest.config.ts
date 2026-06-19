import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(
  new URL(".", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },

  test: {
    environment: "node",

    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],

    clearMocks: true,
    restoreMocks: true,
  },
});