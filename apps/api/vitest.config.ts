import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: false,
    // Integration suites share one Postgres and some mutate schema/indexes
    // (e.g. session dedupe). Parallel files race under Vitest 4's faster pool.
    fileParallelism: false,
  },
});
