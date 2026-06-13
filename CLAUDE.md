See AGENTS.md for agent instructions.

@.claude/rules/commenting.md
@.claude/rules/logging.md

## TypeScript coding standards

Enforced by `tsc` (`strict: true`, ESNext, ES2022). Beyond what `tsc` catches:

- No `any` — use `unknown` and narrow explicitly.
- `const` by default; `let` only where mutation is necessary.
- Early returns over nested `if` ladders.
- Expected failures: return `{ ok: true; ... } | { ok: false; error: string }` tagged unions (see `AttemptResult` in `kernel.ts`). Throw only for programmer errors (invariant violations, unreachable branches).
- No `// @ts-ignore` or `// @ts-expect-error` without a one-line explanation and a note on how to remove it.

## Hooks (automated)

Configured in `.claude/settings.json` — scripts live in `.claude/hooks/`:

- **PostToolUse (Write|Edit|MultiEdit)**: runs `tsc --noEmit` then `eslint --fix` after any `.ts` file change. Fix type errors and lint errors before continuing.
- **PreToolUse (Bash)**: blocks `rm -rf`/`rm --recursive` and force-pushes to `main`/`master`. Requires explicit user confirmation before proceeding.
