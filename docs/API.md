# API reference

All route examples are relative to your own instance. JSON endpoints use no-store caching. CORS permits Stremio clients; CORS is not authorization.

| Method | Route | Purpose / authorization |
| --- | --- | --- |
| GET | `/manifest.json` | Public community manifest |
| GET | `/addon/{key}/manifest.json` | Configured install manifest |
| GET | `/addon/{key}/subtitles/{movie|series}/{id}[/{extra}].json` | Public subtitle discovery; `key` is a language or installation capability |
| GET, HEAD | `/translations/{digest}.srt` | Server-issued exact-source choice; HEAD does not start work |
| GET | `/files/{job-id}.srt` | Job bearer link; resume bounded work and serve complete SRT |
| POST | `/api/config` | Create language/email configuration with explicit consent |
| DELETE | `/api/config/{token}` | Capability-authorized deletion and contact-email clearing |
| POST | `/api/prepare` | Existing subtitle or prepared job; optional `releaseId` |
| POST | `/api/releases` | Available target-language and English source options |
| POST | `/api/demo` | Original two-cue fixture |
| POST | `/api/search` | Movie/series title search |
| POST | `/api/episodes` | Released episode metadata |
| GET | `/api/jobs/{job-id}` | Saved progress; no text/email/IP fields |
| POST | `/api/jobs/{job-id}/step` | One bounded processing checkpoint |
| GET | `/api/refinement-status` | Official API activation/model metadata |
| GET | `/api/requests` | Owner history; admin authentication required |
| GET | `/api/context/{series-id}` | Owner series JSON; admin authentication required |
| POST | `/api/admin/login` | Portable admin token → HttpOnly session |
| POST | `/api/admin/logout` | Clear portable admin session |
| GET | `/health`, `/health/ready` | Liveness / database readiness |

## Prepare one episode

```http
POST /api/prepare
Content-Type: application/json

{"key":"he","type":"series","id":"tt1234567:1:2","filename":"Example.S01E02.mkv"}
```

If `bridge.id` is returned, inspect progress or call the step route until ready/paused. A busy response means another lease owner is processing the job; it is not permission to create another translation job.

`releaseId` is an opaque SHA-256 ID from the server's release listing. It is not a URL. Invalid or unavailable explicit choices fail rather than silently falling back to another release.

## Discovery extras

Stremio extras are encoded in the route segment, e.g. `filename=Example.S01E02.mkv&videoSize=12345&videoHash=0123456789abcdef`. Episode IDs use `tt1234567:1:2`. Do not interpret hashes as proof of a match unless the provider supplies a matching hash.

## Owner requests

```sh
curl -H "Authorization: Bearer YOUR_INSTANCE_ADMIN_TOKEN" \
  'https://YOUR_INSTANCE/api/requests?filter=attention'
```

Filters: `all`, `live`, `attention`; continue using the returned opaque `nextCursor`. The default page size is 25. The browser can instead log in with `/api/admin/login`, receiving a four-hour HttpOnly session cookie. Never publish a real bearer token in a bug report.

## Errors and retries

429 indicates an application/provider quota or paused condition. 503 can indicate discovery already in flight, upstream outage, busy/preparing work, or a transient translation failure. Honor Retry-After and saved retry timestamps. Status and error codes distinguish missing sources from unavailable providers. A failure body is never a valid subtitle file.
