#!/usr/bin/env bash
# Asserts that every file in ./screenshots was uploaded to the CI release since
# $SINCE (ISO timestamp): at least as many new assets as files, and one asset
# named "<timestamp>-<file name>" per file.
# Needs: GH_TOKEN, GH_REPO, CI_RELEASE_ID, SINCE (and the gh CLI).
set -euo pipefail

files=$(find screenshots -maxdepth 1 -type f | wc -l)
assets=$(gh api --paginate "repos/$GH_REPO/releases/$CI_RELEASE_ID/assets" --jq ".[] | select(.created_at >= \"$SINCE\") | .name")
echo "$assets"
[ "$(echo "$assets" | grep -c .)" -ge "$files" ] || { echo "::error::Expected at least $files new release assets"; exit 1; }
for file in screenshots/*; do
  echo "$assets" | grep -q -- "$(basename "$file")$" || { echo "::error::No release asset for $file"; exit 1; }
done
tag=$(gh api "repos/$GH_REPO/releases/$CI_RELEASE_ID" --jq .tag_name)
echo "Release $tag (id $CI_RELEASE_ID) received at least $files new assets"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- Release \`$tag\` (id $CI_RELEASE_ID) received at least $files new assets" >> "$GITHUB_STEP_SUMMARY"
fi
