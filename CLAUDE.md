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
- **TODO (follow-up PR):** Add ESLint — at minimum `@typescript-eslint/recommended` + `no-console` rule. The PostToolUse hook is already wired; once ESLint is configured, update `.claude/hooks/post-ts-typecheck.sh` to run `pnpm exec eslint "$file" --fix` in addition to (or instead of) `tsc --noEmit`. Until then, `tsc --noEmit` is the only automated static check — do not add suppression comments to work around type errors; fix the types.

## Hooks (automated)

Configured in `.claude/settings.json` — scripts live in `.claude/hooks/`:

- **PostToolUse (Write|Edit|MultiEdit)**: runs `tsc --noEmit` after any `.ts` file change. Fix type errors before continuing.
- **PreToolUse (Bash)**: blocks `rm -rf`/`rm --recursive` and force-pushes to `main`/`master`. Requires explicit user confirmation before proceeding.
