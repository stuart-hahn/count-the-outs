#!/usr/bin/env bash
# PreToolUse guard: blocks destructive bash commands before execution.

input=$(cat)
cmd=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || true)

[[ -z "$cmd" ]] && exit 0

# Block rm with recursive flag (-rf, -fr, -r, --recursive)
if echo "$cmd" | grep -qE '\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\b|-[a-zA-Z]*r\b)'; then
  echo "BLOCKED: rm with recursive flag is destructive. Confirm with user before proceeding." >&2
  exit 1
fi

# Block force-push to main or master
if echo "$cmd" | grep -qE '\bgit\s+push\b' \
   && echo "$cmd" | grep -qE '(--force\b|-f\b)' \
   && echo "$cmd" | grep -qE '\b(main|master)\b'; then
  echo "BLOCKED: Force-push to main/master is irreversible. Confirm with user before proceeding." >&2
  exit 1
fi
