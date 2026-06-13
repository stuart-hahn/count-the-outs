## Logging standards

This project is a pure-function engine library with no runtime side effects. No logging library is configured, and none is needed for the `engine` or `math` packages. The absence of logging here is intentional, not an oversight.

### Rules for `src/` files (all packages)

- **Zero `console.*` calls** — no `console.log`, `console.error`, `console.warn`, `console.debug`.
- **Zero `process.stdout.write`** or any other side-effectful output.
- Functions return values or throw; they produce no observable side effects.

### Rules for test files

- `console.*` is allowed during active debugging sessions only.
- Strip all debugging `console.*` calls before committing — they surface as noise in CI logs.

### Rules for future packages that need observability

If a future package (e.g., a training CLI or simulation runner) needs logging:

- Define a minimal interface: `interface Logger { info(msg: string, ctx?: object): void; warn(...): ...; error(...): ...; }`.
- Accept it as a constructor or function parameter — never import a global logger singleton.
- Log levels: `DEBUG` (dev-only, never in production builds), `INFO` (normal operation milestones), `WARN` (recoverable unexpected state), `ERROR` (unrecoverable, requires operator attention).
- **Never log**: raw secrets, player IDs tied to real identities, financial amounts attributable to real users, raw stack traces that expose internal file paths.
- Do not use `console.*` as a substitute for a structured logger in production packages.
