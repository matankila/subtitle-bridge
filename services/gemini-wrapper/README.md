# Anonymous Gemini wrapper sidecar

This service runs the AGPL-3.0 `HanaokaYuzu/Gemini-API` guest client without Google account cookies. Subtitle Bridge sends compact editor, judge and repair prompts to its private `/v1/generate` route.

Required environment:

- `WRAPPER_TOKEN`: long random bearer token, also configured as Subtitle Bridge's `GEMINI_WRAPPER_TOKEN`.
- `GEMINI_TIMEOUT_SECONDS`: optional, default 100.
- `MAX_PROMPT_CHARS`: optional, default 50,000.

Build and run:

```sh
docker build -t subtitle-gemini-wrapper .
docker run --rm -p 8080:8080 -e WRAPPER_TOKEN='replace-with-a-random-secret' subtitle-gemini-wrapper
```

Use an HTTPS endpoint in `GEMINI_WRAPPER_URL`. The service is intentionally serialized to reduce anonymous-IP blocking. It retries once with a fresh guest session, never logs prompt bodies, and exposes no Gemini cookies. Guest access has undocumented quotas and can break when Google changes its private web protocol; Subtitle Bridge retains the Google-based Hebrew draft whenever this sidecar fails.
