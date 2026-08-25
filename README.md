# mgr-registry

Official skill registry for [MGR](https://github.com/maurigre/mgr-method) — the plugin
skills that `mgr add` can install into Claude Code and GitHub Copilot.

```bash
mgr registry add mgr https://raw.githubusercontent.com/maurigre/mgr-registry/main/index.json --trusted
mgr add @mgr/junit-clean
```

Every install shows origin, version, declared permissions and checksum, and waits for your
confirmation. There is no bypass flag. See the
[plugin format documentation](https://github.com/maurigre/mgr-method/blob/main/docs/plugins.md).

## Available skills

| Skill | Category | What it does |
|---|---|---|
| `@mgr/junit-clean` | language | Standardizes Java unit tests with JUnit 5 under 13 strict quality rules |
| `@mgr/diagnosing-bugs` | workflow | Disciplined diagnosis of hard bugs: reproduction loop before hypothesis |

## Layout

```
skills/<name>/
  SKILL.md            the skill itself (Agent Skills standard)
  mgr-manifest.json   the MGR contract: version, category, permissions, model/effort
index.json            GENERATED from the manifests — never edit by hand
scripts/
  build-index.mjs     regenerates index.json (--check fails when out of sync)
  verify-published.mjs downloads every published file and re-checks the checksums
  check-schema-sync.mjs fails when the vendored schema drifts from mgr-method
  plugin-schema.mjs   vendored copy of mgr-method's src/plugin.js (see below)
```

## Publishing a skill

1. Create `skills/<name>/` with the `SKILL.md` and the `mgr-manifest.json`. From a skill you
   already have in an MGR checkout:
   `node scripts/export-plugin.mjs <name> --out <this-repo>/skills`
2. Regenerate the index: `node scripts/build-index.mjs`
3. Open a PR. The CI refuses the PR if a manifest is invalid or the index does not match the
   manifests.

### Publication rules enforced by the CI

Beyond the manifest schema shared with the installer:

- **`permissions` is required.** Declare what the skill needs (`read-files`, `write-files`,
  `run-shell`, `network`), even when minimal. A skill that hides what it does does not get
  published here.
- **`description` must say WHEN to use the skill**, with an explicit trigger clause
  (`Use when ...`) — a description that only says what the skill *is* leaves the agent
  guessing, which is the failure this rule exists to prevent.
- **Scope must be `@mgr`** and the manifest name must match the folder name.
- **`index.json` must be in sync** with the manifests, so what the CLI downloads is always
  what was reviewed in the PR.

### Versioning and checksums

The checksum of a skill covers every file in its folder. Changing any byte of a published
skill changes its checksum, which breaks the lockfile of everyone who installed it — so
**any content change requires a version bump** in `mgr-manifest.json`. Never edit a
published version in place.

## About `scripts/plugin-schema.mjs`

It is a verbatim copy of `src/plugin.js` from the mgr-method repository, so this registry
validates manifests with exactly the same rules the installer applies. Accepting here what
`mgr add` would reject would only surface as a failed install on the user's machine.

The CI runs `scripts/check-schema-sync.mjs`, which compares this copy against
`src/plugin.js` on mgr-method's `main` and fails on any divergence, pointing at the first
differing line. While that file has not reached `main` yet, the check reports itself as
inactive and passes — it starts enforcing on its own the moment the file lands there, with
nothing to switch on.

To sync it after a schema change upstream:

```bash
cp <mgr-method>/src/plugin.js scripts/plugin-schema.mjs
# then restore the header block at the top of the file
node scripts/check-schema-sync.mjs
node scripts/build-index.mjs --check
```

## License

The skills distributed here follow the same source-available license as MGR — see
[LICENSE](LICENSE).
