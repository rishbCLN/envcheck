# Contributing to envcheck

Thanks for helping! envcheck is a small, **zero-dependency** Node CLI, and the
goal is to keep it that way: fast, obvious, and cross-platform.

## Principles

- **No runtime dependencies.** Everything uses Node built-ins (`child_process`,
  `fs`, `path`, `process`). PRs that add a dependency will be asked to remove it.
  In particular there is **no `semver` dependency** — range comparison is a tiny
  built-in comparator in `src/semver.mjs`.
- **Semver and parsing are pure.** The range comparator (`satisfies`,
  `parseVersion`) and the `--version` output parser (`extractVersion`) are pure
  functions with no I/O, so they're trivial to test. Process spawning goes
  through an injectable `run` (`src/run.mjs`), so checks are tested without any
  real tools installed.
- **Safe by default.** Never print env var *values*; validate command names
  before spawning; a missing tool must degrade to a failed check, never a crash.

## Getting started

```bash
git clone https://github.com/YOUR_USERNAME/envcheck.git
cd envcheck
node --test                    # run the suite
node bin/envcheck.mjs          # try it in this repo
```

There's nothing to install — no `npm install` step.

## Running the tests

```bash
node --test
```

Tests live in `test/*.test.mjs` and use only `node:test` + `node:assert/strict`.
They must never touch the network or real external tools, and must never hang —
inject a fake `run`/`existsSync`/`readFileSync` instead.

## Adding or fixing version parsing

If you're improving how a tool's version is detected:

1. Capture the **real** `--version` output for that tool.
2. Add it as a fixture assertion in `test/checks.test.mjs` (for `extractVersion`).
3. If it's about range logic, add cases to `test/semver.test.mjs`.

Keep `runCommandCheck` thin; put the logic in the pure helpers.

## Before you open a PR

- Run `node --test` — CI runs the same on Windows, macOS, and Linux across Node
  18/20/22.
- Keep the change focused and update the README if you touch the CLI surface or
  the `envcheck.json` schema.

## Ideas / good first issues

- A `--fix` mode that prints install/`nvm use` hints per platform.
- More `--version` output fixtures (Java, Go, Python, Ruby, …).
- Group checks by category in the report.
- A short demo GIF for the README.
