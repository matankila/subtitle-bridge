# Export provenance and validation

This public-source snapshot is based on the hosted Subtitle Bridge v0.16.0 source commit `62461ee4944efe0f3503b6c7be2f7d5829111213`, prepared on 2026-10-26 for Matan Keler.

## Included

- Current subtitle engine, source discovery, release-bound choices, series memory, LangGraph review, queue logic, and owner ledger.
- Full preparation UI and owner dashboard.
- Database schema and all five migration files.
- Original core regression suite and added portability/authentication/storage tests.
- Dependency lockfile, portable Cloudflare/Vinext configuration, Node/SQLite API adapter, GitHub CI, and publication checks.
- Optional experimental wrapper source with separate upstream AGPL notice.

## Deliberately omitted or replaced

- No Git history, hosted project/repository IDs, account credentials, secrets, environment files, runtime databases, downloaded subtitles, or operational request logs.
- No generated builds, dependencies, publication archives, or embedded stale source zip.
- Platform-specific connector/identity/preview tooling is replaced by standard runtime configuration and an explicit portable admin boundary.
- The original README/audit accumulated conflicting historical descriptions. New documentation describes the current implementation and its actual limitations.
- The API origin is configurable; self-hosted processing does not relay work to the author's hosted instance.

## Verification

The original 110 core tests passed in the portable tree. Five additional tests cover forged identity-header removal, admin cookie/bearer behavior, placeholder-secret rejection, and SQLite migrations/batch rollback. TypeScript and the standalone Vinext/Cloudflare build were checked locally. Final validation passed all 115 tests, TypeScript, the Vinext/Cloudflare build, and the public-source pattern check. A local Node smoke test confirmed database readiness, a configured manifest, HTTP 401 for forged identity headers, and HTTP 200 for valid admin bearer authentication.

These checks used the already installed dependency tree from the hosted checkout via a temporary local symlink. The symlink/dependency directory is excluded from the archive. A fresh registry install, execution on GitHub Actions, deployment to the recipient's Cloudflare account, and real-device Stremio testing have not been performed for this export.

The hosted v0.16.0 live check served a separate 335-cue Bleach S4E3 source instead of reusing the earlier 254-cue job, with all source timestamps retained. That is historical sample evidence, not a general speed or translation-quality guarantee.

## GitHub publication

Canonical public repository: https://github.com/matankila/subtitle-bridge . The public source export and hosted application are separate deployments; updating this repository does not change the hosted instance automatically.

`scripts/publish-github.sh` remains a CLI alternative for publishing a fork from an authenticated GitHub CLI environment. It contains no credentials.
