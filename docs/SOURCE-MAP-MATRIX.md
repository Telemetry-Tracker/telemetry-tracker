# Live source-map compatibility matrix

Follow-up after the SEO prerequisites PR. Fixture tests already cover webpack sibling maps and Turbopack maps whose hash differs from the chunk (`apps/api/src/lib/source-map-action-upload.test.ts`). This doc tracks **live** uploads that have not been run yet.

## Matrix

| Target | Bundler / host | Upload path | Status |
| --- | --- | --- | --- |
| Next.js 15 | webpack | GitHub Action or CLI against `.next`, `base_url` `https://<host>/_next` | Not run |
| Next.js 16 | Turbopack | Same; confirm `sourceMappingURL` hash mismatch still resolves | Not run |
| Vercel | Next build on Vercel | Upload from the Vercel build job (`.next` is not in a GitHub checkout) | Not run |
| Normal Node | `next start` or Node hosting of a Next build | Upload from CI or release job after `next build` | Not run |

## Pass criteria for each cell

1. Build a minimal app that throws a known minified stack frame.
2. Upload maps with `Telemetry-Tracker/telemetry-tracker/.github/actions/upload-source-maps@main` (or the equivalent CLI) using a source-map-capable project API key.
3. Ingest the error with the same `app` and `release` as the upload.
4. Confirm the dashboard shows the original source file and line, not only the minified chunk.
5. Record the exact Next.js version, Node version, Action ref/SHA, `artifact_path`, `base_url`, and whether the upload ran on GitHub-hosted, Vercel, or a local runner.

## Out of scope here

- Generating the 23 SEO marketing pages
- Changing Cloudflare or DNS
- Publishing npm packages

## Notes

- External repos must not use `uses: ./.github/actions/upload-source-maps`.
- Do not invent pass/fail results in product docs until a row above is executed.
