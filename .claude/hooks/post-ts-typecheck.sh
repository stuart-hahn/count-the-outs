#!/usr/bin/env bash
# PostToolUse: runs tsc --noEmit after any .ts file edit.

input=$(cat)
file=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || true)

# Only act on .ts files
if [[ "$file" != *.ts ]]; then
  exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root"

echo "tsc: checking types..."
output=$(pnpm exec tsc --noEmit 2>&1)
status=$?

if [[ $status -ne 0 ]]; then
  echo "$output" | head -60
  echo ""
  echo "tsc: type errors found — fix before continuing."
  exit 1
fi

echo "tsc: OK"

echo "eslint: linting..."
eslint_output=$(pnpm exec eslint --fix "$file" 2>&1)
eslint_status=$?

if [[ $eslint_status -ne 0 ]]; then
  echo "$eslint_output" | head -60
  echo ""
  echo "eslint: errors found — fix before continuing."
  exit 1
fi

echo "eslint: OK"
