# envcheck

[![CI](https://github.com/YOUR_USERNAME/envcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/envcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/envcheck.svg)](https://www.npmjs.com/package/envcheck)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**One command tells you why the project won't run on a new machine.**

You know the drill. A new contributor clones the repo, runs the app, and burns an
hour discovering their Node version is too old, an env var is missing, and some
required CLI (`docker`, `git`, …) isn't installed. "Works on my machine" — but
not on theirs.

envcheck replaces that hour with one command:

```bash
npx envcheck
```

```
envcheck — environment report

  ✓ node             20.11.0    (required >=18)
  ✓ git              2.44.0     (required *)
  ✗ docker           not found  (required >=24)  → install Docker from docker.com
  ✓ config/app.yml   present
  ✗ env DATABASE_URL missing    (declared in .env.example)

2 problems found. Environment is NOT ready.
```

It reads a tiny `envcheck.json` (or infers one from your `package.json` and
`.env.example`), checks tool versions, env vars, and files, prints a clean
health report, and **exits non-zero if anything required is missing** — so it
drops straight into CI or a `postinstall` hook.

No dependencies. No config required. No account. Just Node 18+.

<!-- Add a short demo GIF here once recorded: ![demo](docs/demo.gif) -->

## Quick start

```bash
# one-off, no install
npx envcheck

# or install globally
npm install -g envcheck
envcheck
```

Add it to a repo so new contributors can self-diagnose:

```jsonc
// package.json
{
  "scripts": {
    "check": "envcheck"
  }
}
```

## Configuration — `envcheck.json`

Drop an `envcheck.json` in your project root:

```json
{
  "commands": [
    { "name": "node", "range": ">=18" },
    { "name": "git", "range": "*" },
    { "name": "docker", "range": ">=24", "severity": "error", "hint": "install Docker from docker.com" }
  ],
  "env": {
    "required": ["API_KEY"],
    "fromExample": ".env.example"
  },
  "files": ["config/app.yml"]
}
```

### Schema

| Key | Type | Description |
| --- | --- | --- |
| `commands` | array | Tools that must be installed. Each: `name` (required), `range` (semver range, default `*`), `severity` (`error` \| `warn`, default `error`), `hint` (shown when it fails). |
| `env` | object | `required`: array of variable names that must be set. `fromExample`: path to an example env file whose keys are *also* required. |
| `files` | array | Paths (relative to cwd) that must exist. Each entry is a string, or `{ "path", "severity", "hint" }`. |

Supported version ranges (implemented with a tiny built-in comparator — no
`semver` dependency): plain versions (`1.2.3`), `>=`, `>`, `<=`, `<`, `=`,
caret (`^1.2`), tilde (`~1.2.3`), x-ranges (`1.2.x`, `1.x`, `*`), space-separated
AND compounds (`>=16 <21`), and `||` unions (`^16 || ^18`).

## Zero-config behaviour

With no `envcheck.json`, envcheck infers requirements from what's already there:

- **`package.json` `engines`** → command version checks (e.g. `"node": ">=18"`).
- **`.env.example`** → each variable name becomes a required env var (values are
  ignored — only names are read).

So most projects get a useful report with no setup at all. Run `envcheck --init`
to turn the inferred requirements into an editable `envcheck.json`.

## Usage in CI

envcheck exits non-zero when a required check fails, so it gates a pipeline out
of the box:

```yaml
# .github/workflows/ci.yml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx envcheck --ci
```

```bash
# or anywhere
npx envcheck --json > env-report.json
```

Exit codes: `0` everything required passed, `1` one or more required checks
failed, `2` bad usage or invalid config.

## Options

| Option | Description |
| --- | --- |
| `--config <file>` | Path to the config file (default: `envcheck.json`) |
| `--init` | Write a starter `envcheck.json` inferred from this project |
| `--json` | Output a machine-readable JSON report |
| `--ci` | Compact, color-free output (non-zero exit on any error) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Safety

- **Never prints secrets.** For env vars, envcheck only ever reports the *name*
  and whether it is set — values are never read into the report or JSON output.
- **A missing tool never crashes.** Spawn failures are caught and reported as a
  failed check, not a stack trace.
- **Injection-guarded.** Command names are validated against a strict charset
  before being spawned, and arguments are passed as an array.
- **Read-only.** envcheck reports and hints; it never installs or modifies your
  environment.

## How it works

No magic — envcheck runs each tool's `--version`, pulls the version number out
of the output with a small pure regex, and compares it against the required
range using a built-in comparator:

| Check | How |
| --- | --- |
| Commands | spawn `<name> --version`, extract `x.y.z`, compare to the range |
| Env vars | is the variable set to a non-empty value? (name only) |
| Files | does the path exist, relative to the working directory? |

The version-extraction and range logic are pure functions, unit-tested against
captured real-world `--version` strings; the process spawning is injected so the
suite needs no real tools.

## Development

```bash
node --test               # run the test suite (Node built-in, zero deps)
node bin/envcheck.mjs --help
```

There's nothing to install — no `npm install` step.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first
issues: more `--version` output fixtures, a `--fix` hint mode, and richer range
support.

## License

MIT. See [LICENSE](LICENSE).
