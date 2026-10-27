# Third-party notices

Original application and public-export adapters are MIT licensed. Dependencies retain their own licenses; the lockfile is not a relicensing instrument.

## Google request/parser adaptation

`lib/vendor/google-core.mjs` adapts request/parser code from `free-google-translate-geanpn` 1.0.2, copyright 2025 Gean Pedro, MIT. The complete notice is retained in `lib/vendor/google-LICENSE.txt`.

Related upstream project: https://github.com/HimAndRobot/stremio-translate-subtitle-by-geanpn . Attribution does not imply endorsement or a Google API entitlement.

## Optional anonymous Gemini wrapper

`services/gemini-wrapper` is an optional separate HTTP service that depends on `HanaokaYuzu/Gemini-API` (`gemini_webapi`), distributed under AGPL-3.0 upstream. Its AGPL obligations are not removed by this repository's MIT license. Review the dependency's current license before hosting/modifying/redistributing that service. It is not required for the official Gemini API path.

Upstream: https://github.com/HanaokaYuzu/Gemini-API . The wrapper is experimental and is not part of the no-key Google Translate client.

## UI, framework, and runtime

React, Next/Vinext, Cloudflare/Wrangler, LangGraph, Drizzle, Lucide, shadcn-related components, Tailwind, and other locked dependencies retain their respective notices and licenses. An existing shadcn license notice is included under `vendor/`. Do not assume the top-level license changes dependency obligations.

Subtitle content and franchise names are not licensed by this repository. No subtitle corpus is included. Stremio, Google, OpenSubtitles, Gemini, DeepL, and other product names belong to their respective owners; this project is an independent community add-on.
