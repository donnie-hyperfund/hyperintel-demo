#!/usr/bin/env bash
# Strip dev tools from production builds.
# Deletes lib/dev/ and replaces lib/dev/dev-provider.tsx with a passthrough stub.
# Run this BEFORE `next build` in the prod Vercel build command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
DEV_DIR="$ROOT/lib/dev"
PROVIDER="$DEV_DIR/dev-provider.tsx"

if [ ! -d "$DEV_DIR" ]; then
  echo "[strip-dev] lib/dev/ already removed — skipping"
  exit 0
fi

# Nuke everything inside lib/dev/
find "$DEV_DIR" -type f ! -name 'dev-provider.tsx' -delete
find "$DEV_DIR" -type d -empty -delete 2>/dev/null || true

# Replace dev-provider with stub
cat > "$PROVIDER" << 'TSX'
'use client';

import type { ReactNode } from 'react';

export function DevProvider({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
TSX

echo "[strip-dev] Stripped lib/dev/ — dev tools removed from build"
