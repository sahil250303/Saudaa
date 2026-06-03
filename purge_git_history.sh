#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# purge_git_history.sh
#
# Permanently removes database.json and response.html from ALL past git commits.
# Run this ONCE after you have confirmed the live deployment is working.
#
# Requirements:
#   pip install git-filter-repo
#
# WARNING: This rewrites git history. Anyone who has cloned the repo must
#          re-clone after you force-push.
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "🔍 Checking git-filter-repo is installed..."
if ! command -v git-filter-repo &>/dev/null; then
  echo "❌  git-filter-repo not found. Install it with:  pip install git-filter-repo"
  exit 1
fi

echo "🧹 Purging database.json from all commits..."
git filter-repo --path database.json --invert-paths --force

echo "🧹 Purging response.html from all commits..."
git filter-repo --path response.html --invert-paths --force

echo "🧹 Purging verify/inspect debug scripts..."
git filter-repo --path inspect_console.js    --invert-paths --force 2>/dev/null || true
git filter-repo --path inspect_preloader.js  --invert-paths --force 2>/dev/null || true
git filter-repo --path verify_redesign_final.js --invert-paths --force 2>/dev/null || true
git filter-repo --path verify_all_views.js   --invert-paths --force 2>/dev/null || true
git filter-repo --path verify_system_security.js --invert-paths --force 2>/dev/null || true

echo ""
echo "✅  History cleaned. Now force-push to GitHub:"
echo ""
echo "    git remote add origin https://github.com/sahil250303/Saudaa.git"
echo "    git push origin main --force"
echo ""
echo "⚠️  After force-push: all collaborators must re-clone the repository."
