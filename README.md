# count-the-outs

Texas Hold'em poker trainer — equity calculation, range analysis, and interactive drill UI.

**Status: pre-implementation.** See `docs/SPEC.md` for architecture and build order.

## Docs

- [`docs/SPEC.md`](docs/SPEC.md) — module map, dependency graph, repo layout, build order
- [`docs/invariants.md`](docs/invariants.md) — load-bearing formulas for legality, betting, pot settlement, payouts; read before touching `/packages/engine`

## Stack (planned)

TypeScript monorepo (pnpm workspaces). Packages: `engine` → `math` → `training` → `ui`. One-way dependency chain.
