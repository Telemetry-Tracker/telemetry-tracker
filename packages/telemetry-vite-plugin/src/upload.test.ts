import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bundleUrlForMapFile,
  findMapFiles,
  resolveUploadEndpoint,
  uploadSourceMapFile,
  uploadSourceMaps,
} from "./upload.js";

describe("resolveUploadEndpoint", () => {
  it("defaults to hosted cloud API", () => {
    expect(resolveUploadEndpoint("https://api.telemetry-tracker.com")).toBe(
      "https://api.telemetry-tracker.com/api/project/source-maps"
    );
  });

  it("preserves self-hosted path prefix", () => {
    expect(resolveUploadEndpoint("https://telemetry.example.com/v1")).toBe(
      "https://telemetry.example.com/v1/api/project/source-maps"
    );
  });
});

describe("bundleUrlForMapFile", () => {
  it("maps relative paths to public bundle URLs", () => {
    const outDir = "/app/dist";
    const mapPath = "/app/dist/assets/app.js.map";
    expect(bundleUrlForMapFile(mapPath, outDir, "https://cdn.example.com")).toBe(
      "https://cdn.example.com/assets/app.js"
    );
  });

  it("strips trailing slash from base URL", () => {
    expect(
      bundleUrlForMapFile("/app/dist/main.js.map", "/app/dist", "https://cdn.example.com/")
    ).toBe("https://cdn.example.com/main.js");
  });

  it("includes Vite base path in bundle URLs", () => {
    expect(
      bundleUrlForMapFile(
        "/app/dist/assets/app.js.map",
        "/app/dist",
        "https://cdn.example.com",
        "/app/"
      )
    ).toBe("https://cdn.example.com/app/assets/app.js");
  });

  it("uses absolute Vite base URLs without duplicating the host", () => {
    expect(
      bundleUrlForMapFile(
        "/app/dist/assets/app.js.map",
        "/app/dist",
        "https://cdn.example.com",
        "https://cdn.example.com/"
      )
    ).toBe("https://cdn.example.com/assets/app.js");
  });

  it("preserves path prefix on absolute Vite base URLs", () => {
    expect(
      bundleUrlForMapFile(
        "/app/dist/assets/app.js.map",
        "/app/dist",
        "https://cdn.example.com",
        "https://cdn.example.com/app/"
      )
    ).toBe("https://cdn.example.com/app/assets/app.js");
  });
});

describe("findMapFiles", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds .map files recursively", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tt-vite-plugin-"));
    mkdirSync(join(tempDir, "assets"), { recursive: true });
    writeFileSync(join(tempDir, "assets", "app.js.map"), "{}");
    writeFileSync(join(tempDir, "index.js"), "console.log('x')");

    expect(findMapFiles(tempDir)).toEqual([join(tempDir, "assets", "app.js.map")]);
  });
});

describe("uploadSourceMaps", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("uploads each map with project headers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tt-vite-plugin-"));
    const mapPath = join(tempDir, "app.js.map");
    writeFileSync(mapPath, JSON.stringify({ version: 3, sources: [], mappings: "" }));

    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const deleteFile = vi.fn();

    const result = await uploadSourceMaps({
      apiKey: "tt_live_pub_secret",
      projectId: "project-uuid",
      release: "1.2.0",
      app: "web",
      outDir: tempDir,
      baseUrl: "https://cdn.example.com",
      baseApiUrl: "https://api.telemetry-tracker.com",
      deleteMapsAfterUpload: true,
      fetchImpl,
      deleteFile,
    });

    expect(result.uploaded).toBe(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0]).toBe("https://api.telemetry-tracker.com/api/project/source-maps");
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({
      "X-Project-Id": "project-uuid",
      "X-API-Key": "tt_live_pub_secret",
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      app: "web",
      release: "1.2.0",
      bundle_url: "https://cdn.example.com/app.js",
    });
    expect(deleteFile).toHaveBeenCalledWith(mapPath);
  });

  it("returns zero uploads when no maps exist", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tt-vite-plugin-"));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await uploadSourceMaps({
      apiKey: "tt_live_pub_secret",
      projectId: "project-uuid",
      release: "1.2.0",
      app: "web",
      outDir: tempDir,
      baseUrl: "https://cdn.example.com",
      fetchImpl,
    });

    expect(result).toEqual({ uploaded: 0, skipped: 0, files: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("uploadSourceMapFile", () => {
  it("throws on API errors", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tt-vite-plugin-"));
    const mapPath = join(tempDir, "bad.js.map");
    writeFileSync(mapPath, JSON.stringify({ version: 3 }));

    try {
      await expect(
        uploadSourceMapFile(
          {
            apiKey: "key",
            projectId: "id",
            release: "1.0.0",
            app: "web",
            outDir: tempDir,
            baseUrl: "https://cdn.example.com",
            fetchImpl: vi.fn(async () => new Response("quota", { status: 403 })),
          },
          mapPath
        )
      ).rejects.toThrow(/Failed to upload bad.js.map: 403/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
