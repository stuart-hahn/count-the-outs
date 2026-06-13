## Comment standards

Write a comment only when the **WHY** is non-obvious. If the code reads clearly, the comment is noise.

### When to comment

- The code implements a load-bearing formula from `invariants.md` — always cite `invariants.md §N` on the line above.
- A value that looks like a magic number is actually a sentinel (e.g., `seen = -1` means "hasn't acted this street yet").
- The code works around a known external bug or non-obvious constraint.
- A long file needs orientation landmarks — use a section banner.

### When NOT to comment

- The function or variable name already says it.
- The code is straightforward arithmetic or data transformation.
- You are restating the code in English ("// increment the counter").
- The comment explains WHAT the code does rather than WHY it does it that way.

### Formats in use

**Section banners** — divide logical sections within a file:
```
// ── section name ─────────────────────────────────────────────────────────────
```

**Invariant citations** — on the line immediately above the load-bearing function:
```ts
// invariants.md §4 — the load-bearing formula
export function needsToAct(...) { ... }
```

**JSDoc on public exports** — one line only, for functions exported from `index.ts`:
```ts
/** Returns null if the hand is terminal or no player needs to act. */
export function currentActor(state: GameState): PlayerId | null { ... }
```
Describe the contract (what it returns, when it returns null, when it throws). Do not describe the algorithm. No multi-line JSDoc blocks. Internal helpers get no JSDoc.

### Hard rules

- Never leave commented-out code blocks in committed code — use git history instead.
- No TODO stubs — if the code is not implemented, do not commit the call site.
- No "added for X feature" or "used by Y caller" comments — these rot immediately and belong in the PR description, not the source file.
- No multi-paragraph comment blocks of any kind.
