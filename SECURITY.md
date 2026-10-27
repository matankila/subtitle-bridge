# Privacy and security

## Report a problem

Do not include live keys, install capabilities, personal request history, or complete copyrighted subtitles in public issues. For a sensitive report, use GitHub private vulnerability reporting if enabled by the repository owner; otherwise first request a private reporting channel without disclosing the exploit or secrets publicly.

## Boundaries

- Public source/job/file links are bearer capabilities. Knowing one can grant access to its subtitle/progress; do not treat them as private account storage.
- Admin history and series context require instance admin authentication in the portable adapters.
- Client-supplied `oai-authenticated-*` headers are removed at the adapter boundary. They are not trusted on a standalone host.
- Subtitle downloads require HTTPS on an explicit host allowlist; redirects are checked too. Arbitrary client download URLs are not accepted.
- Model output is untrusted: cue IDs, scripts, length, evidence quotes, and response structure are checked by code.
- Text prompts provide guards, not proof against all prompt injection or semantic errors. Timestamp preservation does not certify translation correctness.

## Data handling

The source providers receive media identifiers and supplied filename/hash/size metadata. Translation providers receive text. MyMemory may additionally receive the actual transport IP and a user-provided email only after consent. Other configured translators do not receive that email/IP payload from the application.

The database may contain source text, translated text, viewing/release metadata, optional contact email, IP attribution, and quota counters. Owner API responses omit those contact/IP/configuration secrets. Jobs normally last seven days, request history 30 days, and glossary documents 180 days. Expired rows are cleaned opportunistically, not by a guaranteed deletion scheduler.

No movie/audio bytes, account passwords, Stremio tokens, or private Google account cookies are required by the default official-API configuration. Do not put model API keys into the browser or commit `.env`, `.dev.vars`, database files, build artifacts, logs, or real subtitle files.

## Public export

This snapshot omits hosted project IDs, Git history, environment files, runtime state, and deployment credentials. Example values are placeholders. The optional guest-wrapper service is experimental, separate from the official API path, and has its own upstream license/availability constraints.

The project has not had an independent security audit, sustained load test, or comprehensive real-TV compatibility review. Operators remain responsible for HTTPS, secret rotation, access policies, quotas, abuse controls, backups, and deployment-specific logging.
