import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveBundleUrl } = require("../../../../.github/actions/upload-source-maps/upload.cjs") as {
  resolveBundleUrl: (
    mapFilePath: string,
    artifactPath: string,
    baseUrl: string,
    bundleFiles: string[]
  ) => string;
};

function layout(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-maps-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

describe("upload-source-maps bundle URL", () => {
  it("uses the sibling chunk for a webpack-style Next.js map", () => {
    const root = layout({
      "static/chunks/main-abc.js": "/*# sourceMappingURL=main-abc.js.map */",
      "static/chunks/main-abc.js.map": "{}",
    });
    const mapFile = path.join(root, "static/chunks/main-abc.js.map");
    const bundle = path.join(root, "static/chunks/main-abc.js");
    expect(resolveBundleUrl(mapFile, root, "https://app.example/_next", [bundle])).toBe(
      "https://app.example/_next/static/chunks/main-abc.js"
    );
  });

  it("follows sourceMappingURL when the Turbopack map hash differs from the chunk", () => {
    const root = layout({
      "static/chunks/app-111.js": "/*# sourceMappingURL=app-999.js.map */",
      "static/chunks/app-999.js.map": "{}",
    });
    const mapFile = path.join(root, "static/chunks/app-999.js.map");
    const bundle = path.join(root, "static/chunks/app-111.js");
    expect(resolveBundleUrl(mapFile, root, "https://app.example/_next", [bundle])).toBe(
      "https://app.example/_next/static/chunks/app-111.js"
    );
  });
});
