#!/usr/bin/env bash
set -euo pipefail
# Requires GitHub CLI already authenticated to the intended account.
# Run from this repository root. Public publication is intentional.
gh auth status
if [[ ! -d .git ]]; then
  git init -b main
  git add .
  git commit -m "Open-source Subtitle Bridge with architecture and self-hosting"
fi
gh repo create subtitle-bridge --public --source . --remote origin --push \
  --description "Release-aware Stremio subtitle translation with series context and guarded Hebrew review"
