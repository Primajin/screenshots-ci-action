#!/usr/bin/env bash
# Asserts that the first release download URL in a comment body (file given as
# $1) is publicly downloadable: a ranged GET answers with an image or a binary.
set -euo pipefail

url=$(grep -oE 'https?://[^ >")]*/releases/download/[^ >")]*' "$1" | head -1 || true)
[ -n "$url" ] || { echo "::error::No release download URL in the comment"; exit 1; }
ctype=$(curl -sfL -o /dev/null -r 0-0 -w '%{content_type}' "$url") || { echo "::error::Image URL is not publicly downloadable: $url"; exit 1; }
case "$ctype" in
  image/*|application/octet-stream) echo "Image URL resolves ($ctype): $url" ;;
  *) echo "::error::Unexpected content type $ctype for $url"; exit 1 ;;
esac
