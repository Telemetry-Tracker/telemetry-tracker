const fs = require("fs");
const path = require("path");

const BUNDLE_EXTS = new Set([".js", ".mjs", ".cjs", ".css"]);

function parseSourceMappingURL(source) {
  const matches = source.match(/[#@]\s*sourceMappingURL=([^\s*'"]+)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const raw = last.split("=").slice(1).join("=").replace(/[),;]+$/, "");
  if (!raw || raw.startsWith("data:")) return null;
  return raw;
}

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, predicate, results);
    else if (predicate(full, name)) results.push(full);
  }
  return results;
}

function bundleFileForMap(mapFilePath, bundleFiles) {
  const resolvedMap = path.resolve(mapFilePath);
  for (const bundlePath of bundleFiles) {
    const ref = parseSourceMappingURL(fs.readFileSync(bundlePath, "utf8"));
    if (!ref) continue;
    const clean = ref.split("?")[0].split("#")[0];
    if (path.resolve(path.dirname(bundlePath), clean) === resolvedMap) return bundlePath;
  }
  return null;
}

function bundleUrlFor(filePath, artifactPath, baseUrl) {
  const relativePath = path.relative(path.resolve(artifactPath), path.resolve(filePath));
  const normalized = relativePath.split(path.sep).join("/");
  return `${baseUrl.replace(/\/$/, "")}/${normalized}`;
}

function resolveBundleUrl(mapFilePath, artifactPath, baseUrl, bundleFiles) {
  const linked = bundleFileForMap(mapFilePath, bundleFiles);
  if (linked) return bundleUrlFor(linked, artifactPath, baseUrl);
  const fallback = mapFilePath.replace(/\.map$/, "");
  return bundleUrlFor(fallback, artifactPath, baseUrl);
}

async function main() {
  const apiUrl = new URL(process.env.BASE_API_URL || "https://api.telemetry-tracker.com");
  const http = require(apiUrl.protocol === "https:" ? "https" : "http");
  const pathPrefix = apiUrl.pathname.replace(/\/$/, "");
  const uploadPath = `${pathPrefix}/api/project/source-maps`;
  const artifactPath = process.env.ARTIFACT_PATH || "./dist";
  const baseUrl = process.env.BASE_URL || "";
  const appName = process.env.APP_NAME || "";
  const release = process.env.RELEASE || "";
  const projectId = process.env.PROJECT_ID || "";
  const apiKey = process.env.API_KEY || "";

  const mapFiles = walk(artifactPath, (file) => file.endsWith(".map"));
  const bundleFiles = walk(artifactPath, (_file, name) =>
    BUNDLE_EXTS.has(path.extname(name))
  );
  if (mapFiles.length === 0) {
    console.log("No source maps found to upload.");
    return;
  }

  for (const filePath of mapFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const payload = JSON.stringify({
      app: appName,
      release,
      bundle_url: resolveBundleUrl(filePath, artifactPath, baseUrl, bundleFiles),
      content: JSON.parse(content),
    });
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: apiUrl.hostname,
          port: apiUrl.port || undefined,
          path: uploadPath,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Project-Id": projectId,
            "X-API-Key": apiKey,
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            if (res.statusCode >= 400) {
              reject(
                new Error(`Failed to upload ${path.basename(filePath)}: ${res.statusCode} - ${body}`)
              );
            } else {
              console.log(`Successfully uploaded ${path.basename(filePath)}`);
              resolve();
            }
          });
        }
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = { parseSourceMappingURL, resolveBundleUrl };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
