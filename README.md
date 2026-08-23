# tiddlynmem

[![npm version](https://img.shields.io/npm/v/tiddlynmem.svg)](https://www.npmjs.com/package/tiddlynmem)
[![CI](https://github.com/ThaddeusJiang/tiddlynmem/actions/workflows/ci.yml/badge.svg)](https://github.com/ThaddeusJiang/tiddlynmem/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/tiddlynmem.svg)](https://www.npmjs.com/package/tiddlynmem)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Import TiddlyWiki tiddlers into [Nowledge Mem](https://mem.nowledge.co/) as AI memories.

## Agent Usage

```text
Read https://github.com/ThaddeusJiang/tiddlynmem/blob/main/README.md
and import the TiddlyWiki in the current directory into Nowledge Mem.
```

## Human Usage

Run from the TiddlyWiki directory containing `tiddlywiki.info`:

### 1. Plan

Create and review a saved plan. It lists Memory creates, updates, and legacy-marker migrations without writing to Nowledge Mem or modifying source tiddlers.

```bash
npx tiddlynmem plan
```

### 2. Apply

After reviewing and confirming the plan:

```bash
npx tiddlynmem apply
```

`apply` accepts no options and executes `.tiddlynmem/plan.json`.

The default source mode is `sync`. It keeps each source tiddler and records its Memory URI and synchronization digest after a successful write.

To move tiddlers out of the Wiki, create a migrate-mode plan:

```bash
npx tiddlynmem plan --mode migrate
```

After reviewing and confirming its permanent deletions, run bare `apply`:

```bash
npx tiddlynmem apply
```

Migrate mode permanently deletes each selected source tiddler after every planned Memory write succeeds and its source-file snapshot is reverified. Skipped, failed, or concurrently edited tiddlers are not deleted. A tiddler that cannot be rendered or produces empty Markdown is reported as `skipped:render` or `skipped:conversion`; it does not block other tiddlers from being planned or applied, and its source is retained.

## Connect to a remote Nowledge Mem service

Set the endpoint and API key before planning:

```bash
export NMEM_API_URL="https://mem.example.com"
export NMEM_API_KEY="nmem_..."
npx tiddlynmem plan
```

`--api-url` overrides `NMEM_API_URL`. Without either, the default endpoint is `http://127.0.0.1:14242`. Credentials are read only from `NMEM_API_KEY`. The `nmem` CLI is not required.

## CLI reference

| Command | Description |
| --- | --- |
| `plan` | Preview and save an execution plan; default when omitted |
| `apply` | Apply the saved plan; accepts no plan options |

| Plan option | Description |
| --- | --- |
| `--tag <tag>` | Process one exact, case-sensitive TiddlyWiki tag |
| `--limit <count>` | Process at most this many importable tiddlers |
| `--jobs <count>` | Concurrent writes; default: `4` |
| `--mode <mode>` | Source handling: `sync` or `migrate`; default: `sync` |
| `--space-id <id>` | Nowledge Mem space; default: `default` |
| `--wiki-id <id>` | Keep Memory IDs stable when the Wiki moves |
| `--include-sensitive` | Include titles with sensitive terms such as `API key` |
| `--api-url <url>` | Nowledge Mem HTTP or HTTPS endpoint |

| Global option | Description |
| --- | --- |
| `-h`, `--help` | Show help |
| `-V`, `--version` | Show version |

## Import behavior

- Reads only the TiddlyWiki in the current directory.
- Renders WikiText with the active TiddlyWiki runtime and converts it to GitHub Flavored Markdown.
- Keeps Markdown and plain-text tiddlers as text.
- Maps every user-owned TiddlyWiki tag to a Memory label, excluding the importer-owned `$:/NowledgeMem` marker.
- Preserves the Wiki identity, source Wiki, title, user tags, `created`, and `modified` values in Memory metadata.
- Uses stable Memory IDs so reruns remain idempotent.
- In the default `sync` mode, records a confirmed Memory write as the canonical `nowledgemem://memory/<id>` location in the `nmem-uri` tiddler field and the last successful payload-and-destination digest as `nmem-digest: sha256:<hex>`.
- In `migrate` mode, reimports unchanged synced tiddlers and permanently deletes successfully imported standalone `.tid` files or body files with `.meta` sidecars. Shared source files are rejected instead of being deleted.
- Classifies new tiddlers as `ready:create`, changed synced tiddlers as `ready:update`, and legacy `$:/NowledgeMem` markers as `ready:migrate`. Matching digests are `skipped:unchanged` in sync mode and `ready:update` in migrate mode.
- Uses the Memory ID from `nmem-uri` for updates, so a renamed tiddler continues to update the same Memory.
- Saves IDs, options, and content fingerprints to `.tiddlynmem/plan.json` without saving tiddler bodies or credentials.
- Rejects `apply` if the Wiki changed after `plan`.
- Omits embedded data-URI images and warns about local image references.
- Skips system tiddlers, drafts, empty content, unsupported binary types, and titles with sensitive terms such as `API key`. Sync mode also skips unchanged synced tiddlers.
- Reports individual WikiText rendering errors as `skipped:render` and empty conversion results as `skipped:conversion`. These entries do not block the saved plan or its other imports.
- Accepts titles up to 200 characters and bodies up to 32,768 characters; invalid entries are reported without truncation.
- Sync mode never changes a tiddler's body text or source `modified` value. After each confirmed Memory write, `apply` writes only the `$:/NowledgeMem` marker tag, `nmem-uri`, and `nmem-digest`.
- Verifies the scanned source snapshot immediately before sync-state writeback or migrate-mode deletion. A concurrent source edit fails the source operation instead of being overwritten or deleted.

Existing tiddlers that have only the historical `$:/NowledgeMem` marker are migrated by an idempotent upsert during the next reviewed plan and apply. Use the same API URL, `--space-id`, and `--wiki-id` that created the original Memories; the original `--wiki-id` is required if the Wiki moved or the first import used an explicit override. Selecting another API URL or space intentionally produces update actions because the synchronization destination changed.

## Troubleshooting

`Current directory is not a TiddlyWiki root` means the current directory does not contain a readable `tiddlywiki.info`.

`No saved plan found` or `changed after planning` means you must run and review `npx tiddlynmem plan` again before `npx tiddlynmem apply`.

Nowledge Mem health-check errors mean the selected REST service is unavailable or unhealthy. Start the service or set `--api-url` or `NMEM_API_URL` to the correct endpoint before rerunning `apply`.

`skipped:render` and `skipped:conversion` identify source tiddlers that could not produce importable Markdown. Their error details are printed, the sources are retained in both modes, and other planned tiddlers can still be applied.

For `imported:writeback-failed`, the Memory was created or updated but its source sync fields were not saved. Fix the reported file or permission issue and rerun bare `apply` with the preserved plan. If the source changed after apply scanning, review the edit and run a new `plan` before applying again.

For `imported:delete-failed`, the Memory was created or updated but migrate mode did not delete its source tiddler. The saved plan is preserved. Review the reported source-file problem; if the source changed or another tiddler from the plan was already deleted, run and review a new migrate-mode plan before bare `apply`.

`failed:sync-metadata` means a tiddler has an invalid `nmem-uri`, an invalid `nmem-digest`, inconsistent sync fields, or a Memory ID also linked by another tiddler. Correct the conflicting fields instead of allowing tiddlynmem to guess which Memory to overwrite.

## Development

```bash
git clone https://github.com/ThaddeusJiang/tiddlynmem.git
cd tiddlynmem
mise trust && mise install
npm ci
npm run typecheck
npm test
npm run build
npm run check:package
```

Source files are TypeScript and run with [Nub](https://github.com/nubjs/nub). Generated package files are written to the ignored `dist/` directory.

See [AGENTS.md](AGENTS.md) for development and contribution guidance.

## Acknowledgements

Thanks to [TiddlyWiki](https://tiddlywiki.com/), [Turndown](https://github.com/mixmark-io/turndown), [Nub](https://github.com/nubjs/nub), and [Nowledge Mem](https://mem.nowledge.co/).

## Author

[Thaddeus Jiang](https://github.com/ThaddeusJiang)

## License

Copyright 2026 Thaddeus Jiang. Licensed under the [Apache License 2.0](LICENSE).
