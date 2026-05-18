#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

mkdir -p "$HOOKS_DST"

if [ -e "$HOOKS_DST/pre-push" ] && [ ! -L "$HOOKS_DST/pre-push" ]; then
  echo "Existing .git/hooks/pre-push found (not a symlink). Backing up to pre-push.bak"
  mv "$HOOKS_DST/pre-push" "$HOOKS_DST/pre-push.bak"
fi

ln -sf "$HOOKS_SRC/pre-push" "$HOOKS_DST/pre-push"
echo "Installed: .git/hooks/pre-push -> scripts/git-hooks/pre-push"
