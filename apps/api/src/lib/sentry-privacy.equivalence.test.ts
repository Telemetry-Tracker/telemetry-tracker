import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The API cannot import the dashboard file (rootDir is `src`), and the
 * dashboard cannot import the API without pulling server code toward the
 * browser bundle. The copies stay separate. This test fails if they diverge
 * except for the sibling path in the file comment.
 */
function normalize(source: string): string {
  return source.replace(/apps\/(?:api\/src|dashboard)\/lib\/sentry-privacy\.ts/g, "SIBLING");
}

describe("sentry privacy sanitizer drift", () => {
  it("matches the dashboard copy except the sibling-path comment", () => {
    const api = readFileSync(resolve(here, "sentry-privacy.ts"), "utf8");
    const dashboard = readFileSync(
      resolve(here, "../../../../apps/dashboard/lib/sentry-privacy.ts"),
      "utf8"
    );
    expect(normalize(api)).toBe(normalize(dashboard));
  });
});
