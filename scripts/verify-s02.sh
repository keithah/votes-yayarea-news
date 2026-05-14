#!/usr/bin/env bash
set -euo pipefail

html_path="out/debug/races/mayor/index.html"

pnpm validate-data
pnpm test:data
pnpm typecheck
pnpm build

if [[ ! -f "$html_path" ]]; then
  echo "Missing exported debug route: $html_path" >&2
  exit 1
fi

assert_contains() {
  local marker="$1"
  if ! grep -Fq "$marker" "$html_path"; then
    echo "Missing expected marker in $html_path: $marker" >&2
    exit 1
  fi
}

assert_contains "Data debug"
assert_contains "San Francisco Mayor"
assert_contains "mayor"
assert_contains '<th scope="row">Sources</th><td>2</td>'
assert_contains '<th scope="row">Evidence</th><td>2</td>'
assert_contains "Manual override"
assert_contains "present"
assert_contains "manual/overrides/races/mayor.json"

echo "S02 verification passed: data validation, loader tests, typecheck, static export, and mayor debug route markers."
