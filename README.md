# Subtitle Bridge

**Release-aware subtitle translation for Stremio, with reusable series context and a guarded Hebrew review pipeline.**

Built by Matan Keler after repeatedly finding episodes without usable Hebrew subtitles. The goal is practical: spend less time hunting for subtitle files and make machine-translated subtitles more consistent and natural, while keeping a no-payment path available.

Community beta, based on hosted release **0.16.0**. [Try the hosted instance](https://subtitle-bridge.opalcomet7.chatgpt.site). This repository contains the application, translation pipeline, database migrations, tests, optional wrapper service, and self-hosting adapters. It contains no hosted-instance credentials, personal viewing records, subtitle corpus, or deployment identity.

## What it does

- Finds English and target-language subtitles through two OpenSubtitles Stremio sources.
- Keeps differently timed releases separate. Each English file has a distinct Stremio subtitle choice and a source-bound download URL.
- Translates on demand; alternative releases are prepared when selected, rather than translating every available file.
- Preserves parsed cue timestamps and rejects incomplete or misaligned responses.
- Builds a JSON glossary of characters, names, locations, powers, weapons, and explicit gender evidence before reviewing an episode.
- Reuses established Hebrew spellings across episodes; sends only relevant glossary entries to each review batch.
- Uses a LangGraph editor → judge → optional repair graph, with structural validation outside the model.
- Supports optional French, Spanish, and Russian evidence only when source timings align conservatively.
- Deduplicates repeated discovery and identical translation work without merging differently timed files.
- Provides movie/series search, optional release selection, season/series queues, retries, pause controls, and an owner request dashboard.

## Free to use does not mean unlimited

The Google web translation endpoint is **unofficial**, requires no API key, and has no guaranteed quota, availability, or contractual SLA. The optional official Gemini API uses your own project key and its available quota; this repository does not grant an API entitlement. LibreTranslate requires an operator-provided server, and DeepL requires your own credentials. Hosting, compute, and network traffic can cost money.

Protective application caps are separate from upstream provider limits. No proxy rotation, key rotation, fabricated identities, CAPTCHA bypass, or quota evasion is implemented. Use only subtitle files and services you are entitled to access. This is a community tool; human translation quality is not guaranteed.

## Documentation

- [Architecture and implementation](ARCHITECTURE.md): components, flows, job state, release binding, context JSON, concurrency, quotas, storage, and failure handling.
- [Self-hosting and operations](docs/SELF_HOSTING.md): Cloudflare full UI and standalone Node API.
- [API reference](docs/API.md): endpoints, capability links, and admin authentication.
- [Privacy and security](SECURITY.md): trust boundaries, retained data, and responsible disclosure.
- [Third-party notices](THIRD_PARTY_NOTICES.md): adapted translator code and the optional AGPL client.
- [Export provenance](docs/EXPORT_NOTES.md): changes from the hosted edition and verification limits.

## Development

Use Node **22.13+**; Node 24 is used in CI. The test suite uses `node:sqlite`.

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The dependency lockfile comes from the tested hosted source. The public export adds a portable authentication boundary and SQLite adapter. See export notes for the exact local validation completed; a green local build is not proof of a successful deployment to your account.

## Option A: full UI on Cloudflare

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars; replace ADMIN_TOKEN with a long random secret.
pnpm db:migrate:local
pnpm dev
```

Open `http://localhost:5173`. Runtime environment values in `.dev.vars` stay out of Git. Set `PUBLIC_ORIGIN=http://localhost:5173` for this development mode. Public TV clients cannot reach your local loopback address; deploy a public HTTPS endpoint before installing on a TV.

For production, create your own D1 database, replace the placeholder `database_id` in `wrangler.jsonc`, set secrets with Wrangler, apply remote migrations, build, and deploy. [Complete instructions](docs/SELF_HOSTING.md).

## Option B: standalone Node API

```sh
cp .env.example .env
# Edit .env, especially ADMIN_TOKEN and PUBLIC_ORIGIN.
pnpm start:api
```

The API listens on `127.0.0.1:8787` and creates a local SQLite database with the included migrations. This mode includes the Stremio resource, preparation/progress APIs, and subtitle serving. The full React preparation UI is provided by Option A; the Node root page is deliberately minimal.

## Install in Stremio

On a deployed instance, open the preparation page and use **Install in Stremio**, or install this manifest using your own hostname:

```text
https://YOUR_INSTANCE/addon/he/manifest.json
```

`he` selects Hebrew. Other supported language keys are available in setup. Personalized configuration and job URLs are bearer capabilities; keep them private where relevant.

The first translation may take longer than the player's timeout. Finish from the preparation/dashboard page and select the subtitle again. Whole-season preparation requires the browser to remain open and awake; it is not a durable background queue.

## Release matching

A subtitle for the same episode is not necessarily synchronized with the selected video. Hash matches rank first, then exact normalized filename matches. Shared title words only rank candidates; they **never** count as verification. Missing provider metadata produces a **Timing unverified** label.

A cached Hebrew subtitle for release A does not suppress English choices B and C. Each choice is bound to the selected upstream file. Jobs can share output only when their parsed cue text/timings, language, media scope, and translation/refinement identity match exactly.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Useful contributions include reproducible timing mismatches, source-provider fixtures, glossary conflicts, Hebrew quality improvements with source evidence, and tests for retry/cancellation behavior. Do not attach private install links, API keys, or copyrighted full subtitle files to public issues.

## License

Original application and portability code: [MIT](LICENSE). Third-party code and optional services retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
