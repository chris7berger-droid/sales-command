#!/usr/bin/env bash
set -euo pipefail

# Migration safety pre-flight. Run BEFORE any `supabase db push` or
# `supabase migration repair`. Two checks:
#   A — Is this branch behind main on migrations?
#   B — Does the remote ledger have entries that don't match local?

echo "Migration safety pre-flight"
echo "═══════════════════════════"
echo ""

# ── CHECK A: branch behind main on migrations? ──────────────────────────

echo "Check A — comparing local HEAD against origin/main migrations..."

git fetch origin main --quiet 2>/dev/null || {
  echo "  WARNING: could not fetch origin/main (offline?). Skipping Check A."
  echo ""
  CHECK_A_PASS="skip"
}

if [ "${CHECK_A_PASS:-}" != "skip" ]; then
  MISSING_COMMITS=$(git log origin/main ^HEAD --oneline -- supabase/migrations/)
  if [ -n "$MISSING_COMMITS" ]; then
    echo ""
    echo "  FAIL — branch is behind origin/main on migrations."
    echo ""
    echo "  Missing migration commits:"
    echo "$MISSING_COMMITS" | sed 's/^/    /'
    echo ""
    echo "  Missing files:"
    git diff --name-only HEAD origin/main -- supabase/migrations/ | sed 's/^/    /'
    echo ""
    echo "  FIX: git merge origin/main"
    echo ""
    echo "  Do NOT run \`supabase db push\` or \`supabase migration repair\` until"
    echo "  your branch has all of main's migrations. Pushing from a stale branch"
    echo "  risks marking live migrations as reverted (2026-05-18 incident)."
    exit 1
  else
    echo "  PASS — HEAD has all migration commits from origin/main."
  fi
fi

echo ""

# ── CHECK B: remote ledger vs local files ────────────────────────────────

echo "Check B — comparing remote ledger against local migration files..."

MIGRATION_LIST=$(npx supabase migration list 2>&1) || {
  echo "  ERROR: \`supabase migration list\` failed. Output:"
  echo "$MIGRATION_LIST" | sed 's/^/    /'
  echo ""
  echo "  Re-auth with: supabase login && supabase link --project-ref pbgvgjjuhnpsumnowuym"
  exit 1
}

DIVERGENT=0
PROBLEMS=""

while IFS='|' read -r local_col remote_col _rest; do
  local_ts=$(echo "$local_col" | xargs)
  remote_ts=$(echo "$remote_col" | xargs)

  # Skip header/separator lines
  [[ "$local_ts" =~ ^-+$ ]] && continue
  [[ "$local_ts" == "Local" ]] && continue
  [ -z "$local_ts" ] && [ -z "$remote_ts" ] && continue

  if [ -n "$remote_ts" ] && [ -z "$local_ts" ]; then
    # Remote has it, local doesn't
    BRANCH_HITS=$(git log --all --oneline -- "supabase/migrations/${remote_ts}"* 2>/dev/null || echo "")
    if [ -n "$BRANCH_HITS" ]; then
      BRANCH_NAME=$(echo "$BRANCH_HITS" | head -1 | awk '{print $1}')
      CONTAINING=$(git branch --all --contains "$BRANCH_NAME" 2>/dev/null | head -3 | xargs)
      echo "  INFO: ${remote_ts} is on branch ${CONTAINING} (unmerged) — not a divergence."
    else
      DIVERGENT=1
      PROBLEMS="${PROBLEMS}\n  ${remote_ts} — no matching file found on ANY branch.\n"
      PROBLEMS="${PROBLEMS}    This script will NOT mark anything reverted automatically.\n"
      PROBLEMS="${PROBLEMS}    If you have manually confirmed the DDL was never applied to prod,\n"
      PROBLEMS="${PROBLEMS}    run \`supabase migration repair --status reverted ${remote_ts}\` by hand.\n"
    fi
  elif [ -n "$local_ts" ] && [ -z "$remote_ts" ]; then
    # Local has it, remote doesn't — this is normal (pending push)
    :
  fi
done <<< "$MIGRATION_LIST"

if [ "$DIVERGENT" -eq 1 ]; then
  echo ""
  echo "  FAIL — remote ledger has entries not present locally:"
  echo -e "$PROBLEMS"
  echo "  Do NOT run \`supabase migration repair --status reverted\` without"
  echo "  manually confirming the DDL was never applied to prod."
  exit 1
else
  echo "  PASS — remote ledger and local files are aligned."
fi

echo ""
echo "All checks passed. Safe to run \`supabase db push\`."
exit 0
