#!/bin/sh
# Copy brand assets rendered by packages/art (out/brand) into public/ for metadata icons and the OG card.
set -e
SRC="$(dirname "$0")/../../../packages/art/out/brand"
DST="$(dirname "$0")/../public"
cp "$SRC/og-1200x630.png" "$DST/og.png"
cp "$SRC/favicon.ico" "$DST/favicon.ico"
cp "$SRC/favicon-16.png" "$DST/favicon-16.png"
cp "$SRC/favicon-32.png" "$DST/favicon-32.png"
cp "$SRC/apple-touch-icon-180.png" "$DST/apple-touch-icon.png"
echo "brand assets copied"
