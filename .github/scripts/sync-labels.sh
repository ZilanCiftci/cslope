#!/usr/bin/env bash
# Creates or updates the repository's issue labels from .github/labels.json.
# Needs the GitHub CLI (gh), logged in with access to the repository, and jq.
#   bash .github/scripts/sync-labels.sh [owner/repo]
set -euo pipefail
repo="${1:-ZilanCiftci/cslope}"
dir="$(cd "$(dirname "$0")/.." && pwd)"
jq -c '.[]' "$dir/labels.json" | while read -r label; do
  name=$(jq -r .name <<<"$label")
  color=$(jq -r .color <<<"$label")
  desc=$(jq -r .description <<<"$label")
  gh label create "$name" --repo "$repo" --color "$color" --description "$desc" --force
done
