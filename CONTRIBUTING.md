# Contributing

1. Install the pinned dependencies and run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
2. For a timing problem, provide a minimal original fixture, source ID, timestamps, expected behavior, and request/error metadata with secrets removed.
3. For Hebrew quality, include a short source passage, current/expected Hebrew, and the reason for the change. Do not invent speaker gender or apply franchise terminology globally.
4. Add a regression test for alignment, release identity, concurrency, or state recovery when changing these contracts.
5. Keep prompts compact. Preserve code-level validation; do not replace structural checks with “the model was told to preserve it.”
6. Update architecture/operations docs when behavior, persistence, provider payloads, or public routes change.

Never submit API keys, personal install links, viewing logs, database dumps, or full copyrighted subtitle tracks. Preserve existing third-party notices. A public-source change should pass `pnpm source:check`.
