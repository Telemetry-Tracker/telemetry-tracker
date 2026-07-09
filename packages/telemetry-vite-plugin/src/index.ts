import { resolve } from "node:path";
import type { Plugin } from "vite";
import { uploadSourceMaps, type UploadSourceMapsOptions } from "./upload.js";

export type TelemetrySourceMapsPluginOptions = Omit<
  UploadSourceMapsOptions,
  "outDir" | "fetchImpl" | "deleteFile"
> & {
  /** When false, skip upload (default: true). */
  enabled?: boolean;
};

export function telemetrySourceMaps(
  options: TelemetrySourceMapsPluginOptions
): Plugin {
  let outDir = "dist";
  let viteBase = "/";
  let enabled = options.enabled ?? true;

  return {
    name: "telemetry-source-maps",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      viteBase = config.base;
      enabled = options.enabled ?? true;
    },
    async closeBundle() {
      if (!enabled) return;

      const result = await uploadSourceMaps({
        apiKey: options.apiKey,
        projectId: options.projectId,
        release: options.release,
        app: options.app,
        baseUrl: options.baseUrl,
        baseApiUrl: options.baseApiUrl,
        deleteMapsAfterUpload: options.deleteMapsAfterUpload,
        viteBase,
        outDir,
      });

      if (result.uploaded === 0) {
        this.info("[telemetry-source-maps] No source maps found to upload.");
        return;
      }

      this.info(
        `[telemetry-source-maps] Uploaded ${result.uploaded} source map${result.uploaded === 1 ? "" : "s"}.`
      );
    },
  };
}

export {
  bundleUrlForMapFile,
  findMapFiles,
  resolveUploadEndpoint,
  uploadSourceMapFile,
  uploadSourceMaps,
} from "./upload.js";
export type { UploadSourceMapsOptions, UploadSourceMapsResult } from "./upload.js";
