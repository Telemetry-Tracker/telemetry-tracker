import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const DEFAULT_BASE_API_URL = "https://api.telemetry-tracker.com";

export type UploadSourceMapsOptions = {
  apiKey: string;
  projectId: string;
  release: string;
  app: string;
  /** Directory containing build output (typically Vite `build.outDir`). */
  outDir: string;
  /** Public URL prefix where bundled JS is served (no trailing slash). */
  baseUrl: string;
  /** Vite `base` path prefix (e.g. `/app/`) or absolute CDN URL. */
  viteBase?: string;
  /** Telemetry API base URL. */
  baseApiUrl?: string;
  /** Remove `.map` files from disk after a successful upload. */
  deleteMapsAfterUpload?: boolean;
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
  /** Override file deletion (for tests). */
  deleteFile?: (path: string) => void;
};

export type UploadSourceMapsResult = {
  uploaded: number;
  skipped: number;
  files: string[];
};

export function resolveUploadEndpoint(baseApiUrl: string): string {
  const apiUrl = new URL(baseApiUrl || DEFAULT_BASE_API_URL);
  const pathPrefix = apiUrl.pathname.replace(/\/$/, "");
  return `${apiUrl.origin}${pathPrefix}/api/project/source-maps`;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function appendToUrl(base: string, ...pathParts: string[]): string {
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  const segments = [
    ...url.pathname.split("/").filter(Boolean),
    ...pathParts.flatMap((part) => part.split("/")).filter(Boolean),
  ];
  url.pathname = `/${segments.join("/")}`;
  return url.href;
}

export function bundleUrlForMapFile(
  mapFilePath: string,
  outDir: string,
  baseUrl: string,
  /** Vite `base` path prefix (e.g. `/app/`) or absolute CDN URL. */
  viteBase = "/"
): string {
  const resolvedOutDir = resolve(outDir);
  const resolvedMapPath = resolve(mapFilePath);
  const relativePath = relative(resolvedOutDir, resolvedMapPath);
  const jsPath = relativePath.replace(/\.map$/, "");
  const normalizedJsPath = jsPath.split("\\").join("/");

  if (isAbsoluteUrl(viteBase)) {
    return appendToUrl(viteBase, normalizedJsPath);
  }

  const prefix = baseUrl.replace(/\/$/, "");
  const basePath = viteBase.replace(/\/$/, "").replace(/^\//, "");
  if (basePath) {
    return `${prefix}/${basePath}/${normalizedJsPath}`;
  }
  return `${prefix}/${normalizedJsPath}`;
}

export function findMapFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMapFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".map")) {
      results.push(fullPath);
    }
  }
  return results;
}

export async function uploadSourceMapFile(
  options: UploadSourceMapsOptions,
  mapFilePath: string
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = resolveUploadEndpoint(options.baseApiUrl ?? DEFAULT_BASE_API_URL);
  const content = readFileSync(mapFilePath, "utf8");
  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new Error(`Invalid source map JSON: ${basename(mapFilePath)}`);
  }

  const payload = {
    app: options.app,
    release: options.release,
    bundle_url: bundleUrlForMapFile(
      mapFilePath,
      options.outDir,
      options.baseUrl,
      options.viteBase
    ),
    content: parsedContent,
  };

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Project-Id": options.projectId,
      "X-API-Key": options.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to upload ${basename(mapFilePath)}: ${response.status}${body ? ` - ${body}` : ""}`
    );
  }
}

export async function uploadSourceMaps(
  options: UploadSourceMapsOptions
): Promise<UploadSourceMapsResult> {
  const resolvedOutDir = resolve(options.outDir);
  if (!statSync(resolvedOutDir).isDirectory()) {
    throw new Error(`Output directory does not exist: ${resolvedOutDir}`);
  }

  const mapFiles = findMapFiles(resolvedOutDir);
  if (mapFiles.length === 0) {
    return { uploaded: 0, skipped: 0, files: [] };
  }

  const uploadedFiles: string[] = [];
  for (const mapFile of mapFiles) {
    await uploadSourceMapFile(options, mapFile);
    uploadedFiles.push(mapFile);
  }

  if (options.deleteMapsAfterUpload) {
    const deleteFile = options.deleteFile ?? unlinkSync;
    for (const mapFile of uploadedFiles) {
      deleteFile(mapFile);
    }
  }

  return {
    uploaded: uploadedFiles.length,
    skipped: 0,
    files: uploadedFiles,
  };
}
