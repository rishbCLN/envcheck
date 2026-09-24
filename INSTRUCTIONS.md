# envcheck — build instructions

> Self-contained build spec. A fresh session should be able to build, test, and ship this tool by following this file top to bottom. Do not add runtime dependencies.

| Field | Value |
| --- | --- |
| Product name | **envcheck** |
| Tagline | *One command tells you why the project won't run on a new machine.* |
| Folder id | `star-tool4-envcheck` |
| Intended repo / npm name | `envcheck` (verify; fallbacks: `env-doctor`, `envcheck-cli`) |
| Status | Planned |
| License | MIT |

---

## 1. Problem & audience
"Works on my machine." A new contributor clones a repo and burns an hour discovering the Node version is wrong, an env var is missing, and a required CLI (docker/git) isn't installed. There's no single "is my environment ready?" check.

**Audience:** teams onboarding devs, OSS maintainers reducing "it won't run" issues, and anyone setting up a project on a fresh machine.

## 2. Why it earns stars
- Fixes real onboarding pain — maintainers add it to their repos, which spreads it.
- Output is a clean, screenshot-worthy **health report** (green checks / red X's).
- A tiny declarative config (`envcheck.json`) makes it adoptable per-project → viral in READMEs.

## 3. Scope
**MVP**
- Read an `envcheck.json` describing requirements:
  - runtime versions (`node`, `npm`, and generic `commands` with version ranges),
  - required env vars (names, optionally compared against `.env.example`),
  - required files/dirs.
- Zero-config fallback: if no `envcheck.json`, infer from `package.json` `engines` + `.env.example`.
- Print a pass/fail report; **exit non-zero if any hard requirement fails** (CI-friendly).

**Stretch**
- `--init` to scaffold `envcheck.json` from the current project.
- `semver`-style range checks (implement a tiny comparator; no `semver` dep).
- `--fix` hints (e.g., "run nvm use 20").
- `--json` report; `--ci` compact mode.
- Groups/severity (`warn` vs `error`).

**Non-goals**
- No installing/modifying the environment (report + hints only). No secrets printed.

## 4. Tech & constraints
- Node **>= 18**, ESM, **zero runtime deps**.
- `node:child_process` (probe `--version`), `node:fs`, `node:process.env`.
- Entry `bin/envcheck.mjs`.

## 5. CLI / UX design
```
Usage: envcheck [options]

Options:
  --init       Create envcheck.json from this project
  --json       Machine-readable report
  --ci         Compact output, non-zero exit on any error
  --config <f> Path to config (default: envcheck.json)
  -h, --help
  -v, --version
```

Example:
```
$ npx envcheck
envcheck — environment report

  ✓ node        v20.11.0   (required >=18)
  ✓ git         2.44.0     (required *)
  ✗ docker      not found  (required >=24)  → install from docker.com
  ✓ .env        present
  ✗ env DATABASE_URL   missing (declared in .env.example)

2 problems found. Environment is NOT ready.
```

## 6. `envcheck.json` schema (document this precisely in README)
```json
{
  "commands": [
    { "name": "node", "range": ">=18" },
    { "name": "docker", "range": ">=24", "severity": "error" }
  ],
  "env": {
    "required": ["DATABASE_URL", "API_KEY"],
    "fromExample": ".env.example"
  },
  "files": ["config/app.yml"]
}
```

## 7. Architecture & file layout
```
envcheck/
  bin/envcheck.mjs
  src/config.mjs     # load + validate envcheck.json; infer fallback from package.json
  src/checks.mjs     # runCommandCheck / runEnvCheck / runFileCheck -> results
  src/semver.mjs     # tiny range comparator (>=, ^, ~, x-ranges) + tests
  src/report.mjs     # pure: results -> formatted string / json
  src/args.mjs
  test/semver.test.mjs
  test/report.test.mjs
  test/config.test.mjs
  package.json
  README.md
  LICENSE
  CONTRIBUTING.md
  .github/workflows/ci.yml
  .gitignore
```

## 8. Implementation steps
1. Scaffold package.json/bin/license/gitignore.
2. `semver.mjs`: parse versions + ranges; comparator. **Test first, heavily** — this is the trickiest bit.
3. `config.mjs`: load/validate JSON; fallback inference from `package.json` engines + `.env.example`.
4. `checks.mjs`: spawn `<cmd> --version`, extract version via regex, compare; env presence; file presence. Keep the version-extraction regex + compare pure/testable.
5. `report.mjs`: pure formatter (human + `--json`).
6. `args.mjs`; `--init` writer; wire `bin`; correct exit codes.
7. Tests + CI + README (include the schema + a copy-paste `npx envcheck` badge idea).

## 9. Edge cases & safety
- A required command missing must **not** crash — capture spawn error, mark as fail.
- Never print env var **values** — only names + present/missing (secret-safe by design).
- Unknown/za malformed config → clear validation error listing offending keys.
- `.env.example` parsing ignores comments/blank lines; compares names only.
- Validate command names against a safe charset before spawning (injection guard); pass args as array.
- Exit 0 only when all `error`-severity checks pass.

## 10. Testing plan (`node --test`)
- `semver`: `>=18` vs `20.11.0` true; `^1.2` vs `1.9` true / `2.0` false; x-ranges; junk input.
- Version extraction: parse real `--version` strings (`git version 2.44.0`, `Docker version 24.0.7, build ...`).
- `report`: given mixed results → correct summary + exit intent + JSON shape.
- Config fallback from a fixture `package.json`.

## 11. README outline
Badges → "works on my machine" pain → `npx envcheck` report screenshot → `envcheck.json` schema → zero-config behavior → CI usage snippet → options → install → contributing → license.

## 12. Distribution
`npm publish`, bin + shebang, tag, Release. Encourage adding `npx envcheck` to other repos' setup docs (growth loop).

## 13. Launch checklist
Report screenshot → Show HN → r/devops, r/node, r/programming → dev.to → add to `awesome-zero-dependency`.

## 14. Definition of Done + star-magnet checklist
- [ ] Zero-config run works from just `package.json` + `.env.example`.
- [ ] `envcheck.json` fully supported + documented schema.
- [ ] Never prints secret values; missing tools never crash.
- [ ] Correct non-zero exit for CI.
- [ ] CI green; tests pass; published; listed in awesome list.
