#!/usr/bin/env bash
# Use if `npm run dev` fails because Node/npm inherit a bad NODE_OPTIONS.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unset NODE_OPTIONS
cd "$ROOT/apps/web"
exec node ./run-next-with-env.cjs dev -p 3001 --webpack
