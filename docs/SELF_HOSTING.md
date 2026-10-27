# Self-hosting and operations

## Choose a runtime

| Runtime | Includes | Storage |
| --- | --- | --- |
| Cloudflare Worker + Vinext | Full React preparation UI, dashboard, and all APIs | Your D1 database |
| Standalone Node | Stremio resources and all core APIs; minimal landing page | Local SQLite file |

Neither option includes a private deployment account, API entitlement, or a background processing service. The hosted demo and your installation use separate databases and quotas.

## Prerequisites

- Node 22.13+ (Node 24 in CI).
- The pinned pnpm version from `package.json`.
- Outbound HTTPS to the selected catalog, subtitle, translation, and optional model endpoints.
- A public HTTPS address reachable from Stremio for TV installation.
- A long random instance admin secret if using owner history/context routes.

Generate an admin secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep it in `.dev.vars` / `.env` or your deployment secret store. Do not commit it or embed it into install links. The example placeholder is rejected by the authentication boundary.

## Full UI: local development

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```dotenv
PUBLIC_ORIGIN=http://localhost:5173
ADMIN_TOKEN=REPLACE_WITH_YOUR_GENERATED_SECRET
REQUEST_HISTORY_OWNER_EMAIL=owner@localhost
GOOGLE_TRANSLATE_ENABLED=true
GEMINI_REFINEMENT_ENABLED=false
```

Then:

```sh
pnpm db:migrate:local
pnpm dev
```

Use `/requests` to sign in with the instance admin token. `owner@localhost` is an internal marker, not a real user mailbox and not an email sent to MyMemory.

A local HTTP address is for development. Do not expect another device's Stremio client to reach your loopback interface.

## Cloudflare production

1. Authenticate Wrangler to **your** Cloudflare account.
2. Create D1:

   ```sh
   pnpm exec wrangler d1 create subtitle-bridge
   ```

3. Copy the returned database ID into `wrangler.jsonc`. The all-zero ID is a local placeholder, not a deployable database identity.
4. Set `PUBLIC_ORIGIN` to the final HTTPS Worker/custom-domain origin. Leave `REQUEST_HISTORY_OWNER_EMAIL=owner@localhost`, or use a non-secret owner marker consistently.
5. Set secrets:

   ```sh
   pnpm exec wrangler secret put ADMIN_TOKEN
   # Optional official model review:
   pnpm exec wrangler secret put GEMINI_API_KEY
   ```

6. Set non-secret provider switches in Wrangler vars. For official Gemini review, enable `GEMINI_REFINEMENT_ENABLED=true` and configure `GEMINI_REFINEMENT_MODEL` to a model your project can access. The baseline used `gemini-3.5-flash-lite`; availability/quota are project-specific.
7. Apply migrations and deploy:

   ```sh
   pnpm db:migrate:remote
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm deploy
   ```

8. Configure the final domain/HTTPS and confirm `PUBLIC_ORIGIN` matches it. This origin is used for bounded self-relayed processing requests.
9. Verify `/health/ready`, prepare the original two-line demo, inspect actual Hebrew output, and install `/addon/he/manifest.json` in Stremio.

Never copy a hosted identity header into a public reverse-proxy configuration as proof of authentication. The portable Worker strips these client-controlled headers and injects an internal identity only after admin authentication.

## Standalone Node

```sh
cp .env.example .env
# Edit PUBLIC_ORIGIN, ADMIN_TOKEN and provider settings.
pnpm start:api
```

The default binding is loopback-only. `SQLITE_PATH` defaults to `./data/subtitle-bridge.sqlite`; parent directories and migrations are created automatically. WAL mode and a busy timeout are enabled. The adapter is intended for a single Node process. It is not a distributed SQLite coordination service.

A reverse proxy can expose the process over HTTPS. Configure its public origin in `PUBLIC_ORIGIN`. The Node adapter uses the actual socket peer for quota attribution and removes supplied `cf-connecting-ip`; it does not blindly trust X-Forwarded-For. Behind a proxy, that means attribution may be shared under the proxy address. Proper trusted-proxy support is future work.

## Provider configuration

| Setting | Meaning |
| --- | --- |
| `GOOGLE_TRANSLATE_ENABLED` | Enable the unofficial no-key web translation path |
| `GOOGLE_RPC_BATCH_ENABLED=false` | Disable indexed RPC path |
| `GEMINI_REFINEMENT_ENABLED` | Enable optional Hebrew review/context when a model backend is configured |
| `GEMINI_API_KEY` | Your official server-side model key |
| `GEMINI_REFINEMENT_MODEL` | Accessible configured model; do not assume free-tier availability |
| `GEMINI_REFINEMENT_BATCH_SIZE` | Default 96, bounded 24–120 cues |
| `GEMINI_WRAPPER_URL` / `GEMINI_WRAPPER_TOKEN` | Optional experimental private wrapper |
| `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_API_KEY` | Your own authorized translation server |
| `DEEPL_API_KEY` | Your official DeepL account key |
| `TRANSLATION_MONTHLY_CHAR_LIMIT` | Protective application ceiling, not an upstream entitlement |
| `SUBTITLE_GLOSSARY_HE_JSON` | Operator override map of exact Hebrew spellings |
| `ADMIN_TOKEN` | Admin dashboard/context authentication |
| `REQUEST_HISTORY_OWNER_EMAIL` | Internal owner marker used after authentication |

The official Gemini key is used server-side. Do not put it in `NEXT_PUBLIC_*`, browser localStorage, issue bodies, screenshots, URLs, or the repository. The optional wrapper is separate and is not needed when using the official API.

## Preparing a season

The UI searches Cinemeta, loads released episodes, and creates a local browser queue. Choose automatic release ranking or select releases per episode. Run/resume, retry failed/skipped/missing items, or pause after the current request/episode.

Keep the tab open and the device awake. Refreshing/shutdown pauses orchestration; the next run resumes valid server checkpoints. Do not run the same localStorage queue simultaneously in multiple tabs. Server job leases still prevent competing steps from owning the same job at once.

## Monitoring and recovery

- `/health`: process/service liveness.
- `/health/ready`: database access, not upstream provider health.
- `/requests`: owner activity, duplicate hit counts, live state, phase, timings, failed review batches.
- `/api/context/<series-id>`: owner-visible context JSON.
- Paused quota: wait for the actual upstream/account window, then resume; do not rotate identities.
- Google cooldown: saved work is retained; a configured authorized fallback may continue.
- Lost client connection: allow the current lease/checkpoint window to settle, then use Finish translation.
- Wrong timing: select a different source choice; do not treat the same episode title as a release match.

## Data lifecycle and backups

Back up D1 or the SQLite database using the storage provider's supported process. SQLite deployments should use a consistent backup mechanism, not copy a live WAL database file without its transaction context. Protect backups as they may contain source subtitles, viewing metadata, optional emails, and IP attribution.

Jobs/files expire seven days after job creation. History is retained 30 days. Context JSON lasts 180 days with renewal. Cleanup runs opportunistically on application traffic; consider a supported periodic maintenance strategy if you need strict deletion timing.

## Production work still required

Configure log redaction, monitoring/alerts, spending caps, backups, restore drills, origin/proxy controls, and capacity limits. Run a real device/player matrix and multi-user load tests. No local test suite demonstrates these deployment properties by itself.
