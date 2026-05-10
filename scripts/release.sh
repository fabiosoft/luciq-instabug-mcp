#!/usr/bin/env bash
# Cuts a new release end-to-end:
#   1. Bumps package.json version
#   2. Commits + tags + pushes to origin
#   3. Watches the GitHub Actions release workflow
#   4. Reads the published sha256 from SHA256SUMS
#   5. Updates the formula in fabiosoft/homebrew-tap (url + sha256)
#   6. Pushes the tap update
#
# Usage: scripts/release.sh <version>           e.g. scripts/release.sh 0.3.0
#
# Note: If the workflow fails, the script returns a non-zero exit code, but the tag and the `chore(release)` commit remain pushed. To retry: `git tag -d vX.Y.Z && git push origin :vX.Y.Z`, then run the workflow again.
# Requires: gh (logged in to the source-repo owner), node, npm, git, curl.

set -euo pipefail

SRC_REPO="fabiosoft/luciq-instabug-mcp"
TAP_REPO="fabiosoft/homebrew-tap"
FORMULA="luciq-instabug-mcp"
COMMIT_NAME="${RELEASE_COMMIT_NAME:-Fabio Nisci}"
COMMIT_EMAIL="${RELEASE_COMMIT_EMAIL:-fabionisci@gmail.com}"

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; }

[[ "${1:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$ ]] || { usage; exit 1; }
VERSION="$1"
TAG="v${VERSION}"

for c in gh node npm git curl awk sed; do
  command -v "$c" >/dev/null || { echo "missing dependency: $c" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "gh not logged in" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

[[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean" >&2; exit 1; }
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag ${TAG} already exists locally" >&2; exit 1
fi

BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" ]] || { echo "detached HEAD; checkout a branch first" >&2; exit 1; }

echo "==> bump package.json to ${VERSION}"
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
git add package.json
[[ -f package-lock.json ]] && git add package-lock.json
git commit -m "chore(release): ${TAG}"
git tag -a "$TAG" -m "$TAG"

echo "==> push ${BRANCH} + ${TAG}"
git push origin "$BRANCH"
git push origin "$TAG"

echo "==> locate release workflow run"
RUN_ID=""
for _ in 1 2 3 4 5 6 7 8; do
  sleep 3
  RUN_ID="$(gh run list --repo "$SRC_REPO" --workflow release.yml --limit 5 \
              --json databaseId,headBranch \
              -q ".[] | select(.headBranch==\"${TAG}\") | .databaseId" | head -1)"
  [[ -n "$RUN_ID" ]] && break
done
[[ -n "$RUN_ID" ]] || { echo "could not find workflow run for ${TAG}" >&2; exit 1; }

echo "==> watch run ${RUN_ID}"
gh run watch --repo "$SRC_REPO" "$RUN_ID" --exit-status

echo "==> fetch sha256 from release"
SHA="$(curl -fsSL "https://github.com/${SRC_REPO}/releases/download/${TAG}/SHA256SUMS" | awk 'NR==1{print $1}')"
[[ "$SHA" =~ ^[a-f0-9]{64}$ ]] || { echo "bad sha256: ${SHA}" >&2; exit 1; }
echo "    ${SHA}"

echo "==> update tap formula"
TOKEN="$(gh auth token)"
TAP_DIR="$(mktemp -d)"
trap 'rm -rf "$TAP_DIR"' EXIT
git clone --quiet "https://x-access-token:${TOKEN}@github.com/${TAP_REPO}.git" "$TAP_DIR"

cd "$TAP_DIR"
FORMULA_FILE="Formula/${FORMULA}.rb"
[[ -f "$FORMULA_FILE" ]] || { echo "formula not found in tap: ${FORMULA_FILE}" >&2; exit 1; }

NEW_URL="https://github.com/${SRC_REPO}/releases/download/${TAG}/${FORMULA}-${VERSION}.tar.gz"
sed -i.bak -E \
  -e "s|^(  url \").*(\")$|\\1${NEW_URL}\\2|" \
  -e "s|^(  sha256 \")[a-f0-9]+(\")$|\\1${SHA}\\2|" \
  "$FORMULA_FILE"
rm -f "${FORMULA_FILE}.bak"

if git diff --quiet -- "$FORMULA_FILE"; then
  echo "tap formula already up to date — nothing to push" >&2
  exit 1
fi

git -c "user.name=${COMMIT_NAME}" -c "user.email=${COMMIT_EMAIL}" \
    commit -am "${FORMULA} ${VERSION}"
git push --quiet origin main

cd "$ROOT"

cat <<EOF

✅ released ${TAG}

Test on a clean machine:
  brew update
  brew upgrade ${FORMULA}            # if already installed
  brew install fabiosoft/tap/${FORMULA}   # first time
EOF
