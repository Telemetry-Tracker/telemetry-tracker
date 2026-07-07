**Base branch:** open feature and fix PRs against **`develop`**. Milestone releases promote **`develop` → `main`** — see [docs/RELEASE.md](../docs/RELEASE.md).

## Summary

<!-- What does this PR change and why? -->

## How to test

<!-- e.g. pnpm lint && pnpm test; manual steps for dashboard/API. -->

## Code review (Bugbot)

- [ ] For **notification, alert, billing, ingest, or auth** changes: ran **`/review-bugbot`** in Cursor before opening this PR (optional but recommended — GitHub Bugbot may skip duplicate review)
- [ ] Addressed or replied to Bugbot findings (resolve thread + update [`.cursor/BUGBOT.md`](../.cursor/BUGBOT.md) if a finding was a false positive)

## Checklist

- [ ] Tests pass (`pnpm test`; use `RUN_DB_INTEGRATION_TESTS=true` + Postgres if API integration behavior changed)
- [ ] Lint passes (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)
- [ ] [CHANGELOG.md](../CHANGELOG.md) updated under `[Unreleased]` (if user-facing)
- [ ] Documentation updated (if needed)
- [ ] New code follows the existing style
- [ ] No breaking changes (or called out clearly above)

## Security / privacy

<!-- N/A, or note any auth, ingest, or data-handling implications. -->
