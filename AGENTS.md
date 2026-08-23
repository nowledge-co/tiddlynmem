# AGENTS.md

This file is the development and contribution contract for AI coding agents working in this repository.

## Project purpose

`tiddlynmem` imports tiddlers from one Node.js TiddlyWiki into Nowledge Mem. It boots the real Wiki with the npm `tiddlywiki` package, renders WikiText to HTML, converts that HTML to GitHub Flavored Markdown, and upserts each result through the selected Nowledge Mem REST API.

`README.md` is the user-facing source of truth for installation and usage. Keep it synchronized whenever CLI behavior changes.

## Non-negotiable behavior

- The current working directory is the only Wiki input.
- The command must be run from a directory containing a readable `tiddlywiki.info`.
- Do not restore `--wiki`, hardcoded Wiki names, parent-directory scans, or sibling-directory scans.
- The CLI uses Terraform-style saved-plan semantics. Omitting the command defaults to `plan`; `plan` accepts all selection and execution options, while `apply` accepts no plan options and executes `.tiddlynmem/plan.json`.
- Only the `apply` command may write to Nowledge Mem or modify source tiddlers. `plan` may only replace its local, body-free saved-plan artifact. The saved source mode is `sync` by default. In sync mode, after a specific Memory write succeeds, record `$:/NowledgeMem`, `nmem-uri`, and `nmem-digest` on that source tiddler without changing its text, source `modified` value, or duplicating the tag. In migrate mode, delete imported source tiddlers only after every planned Memory write succeeds and immediately revalidate each source-file snapshot before deletion.
- Treat `$:/NowledgeMem` as the historical imported marker and `nmem-uri` plus `nmem-digest` as the current synchronization state. The self-describing `sha256:<hex>` digest covers the Memory payload, selected API URL, and space. In sync mode, classify matching digests as `skipped:unchanged`, changed digests as `ready:update`, and marker-only or incomplete valid state as `ready:migrate`; never write an unchanged Memory. In migrate mode, re-upsert an unchanged managed tiddler before deleting its source.
- When `--tag <tag>` is present, filter exact matching tiddlers inside the TiddlyWiki worker before WikiText rendering. Only matching records enter scanning, terminal output, classification, conversion, or import. Normal safety classification still applies after this input filter.
- Never write sync tags or fields to plan-only, skipped, or Memory-API-failed tiddlers. Treat per-tiddler render errors and empty conversion results as non-blocking `skipped:render` and `skipped:conversion` outcomes. Never delete those tiddlers in migrate mode. Before sync-state writeback or deletion, verify the raw source file against the apply scan snapshot; reject a concurrent edit instead of overwriting or deleting it. Delete only standalone `application/x-tiddler` files or independently editable body files with an existing `.meta` sidecar; never delete shared or unsupported source formats.
- Do not require the `nmem` CLI at runtime. Both `plan` and `apply` must work without it.
- During `plan`, resolve the REST API URL in this order: `--api-url`, `NMEM_API_URL`, then `http://127.0.0.1:14242`, and store the resolved non-credential URL in the saved plan.
- Check the selected service's `/health` endpoint directly before writing.
- Accept any explicitly selected HTTP or HTTPS endpoint without an additional confirmation flag.
- Read REST credentials only from `NMEM_API_KEY`, send them as Bearer authentication, never pass them to TiddlyWiki workers, and never log them.
- Never follow HTTP redirects for health checks or Memory writes. Users must configure the final Nowledge Mem API URL directly.
- Preserve deterministic Memory IDs based on a collision-resistant Wiki identity and tiddler title for new and legacy-marker tiddlers. The default identity combines the Wiki directory name with a resolved-path fingerprint; `--wiki-id` provides an explicit portable override. Once `nmem-uri` exists, preserve its Memory ID across edits and title changes.
- Preserve Unicode in source-Wiki labels and use a deterministic fallback when the normalized Wiki name contains no letters or numbers.
- Preserve the default sensitive-title filter unless a deliberate behavior change includes tests and README updates.

## Language and runtime

- TypeScript everywhere.
- Do not add `.js` or `.mjs` source files.
- Run TypeScript directly with [Nub](https://github.com/nubjs/nub); do not use Bun.
- Keep `@nubjs/nub` as a development dependency for source execution and package builds.
- Keep `strict` TypeScript enabled.
- Use ESM imports with explicit `.ts` extensions, matching the existing codebase.
- Prefer small functions and declarative data transformations over unnecessary classes.
- Do not add a dependency when the Node.js standard library or an existing dependency is sufficient.

## Repository map

- `src/cli.ts`: CLI orchestration, current-directory validation, terminal results, and concurrent imports.
- `src/core.ts`: tiddler classification, metadata, stable IDs, HTML-to-Markdown conversion, and media warnings.
- `src/tiddlywiki-worker.ts`: boots TiddlyWiki and sends records over IPC.
- `src/tiddlywiki-sync-worker.ts`: boots TiddlyWiki after successful upserts and either persists sync state or deletes migrate-mode source tiddlers.
- `src/tiddlywiki.ts`: owns read and sync worker lifecycles, IPC validation, and diagnostics.
- `src/nmem.ts`: resolves and validates the selected service URL, checks REST health, and posts native Memory requests.
- `src/options.ts`: parses supported command-line options.
- `src/plan.ts`: atomically saves, validates, fingerprints, and consumes the local execution plan.
- `scripts/build-package.ts`: compiles the npm package and changes only the generated CLI shebang from Nub to Node.
- `test/`: Node test runner coverage and a minimal TiddlyWiki fixture.
- `dist/`: generated npm package output; ignored, never edited, and never committed.

## npm CLI contract

- The npm package name is `tiddlynmem`.
- The executable name is `tiddlynmem`, mapped to generated `dist/cli.js` through `package.json#bin`.
- Source and build scripts remain TypeScript and run directly with Nub during development.
- `npm prepack` must type-check, test, and generate `dist/`; the generated JavaScript is package output, not source.
- `npm prepack` must also start the generated CLI under plain Node through `npm run check:package`.
- Do not hand-edit or commit generated `.js` files, and do not add a handwritten `.js` or `.mjs` launcher.
- The published package must not depend on Nub at runtime; plain Node executes the generated CLI.
- Print every ready, skipped, and failed tiddler with its complete source tag list, plus skipped totals by reason. Do not print tiddler bodies.
- Escape terminal control characters in all tiddler-derived fields, diagnostics, paths, warnings, and errors before printing them.
- Never include raw Nowledge Mem API response bodies in errors or terminal output.
- Treat a Memory write as successful only when the native response contains `memory.id` matching the requested Memory ID. Malformed or mismatched success responses must not trigger source sync writeback.
- Keep npm package metadata, CLI help, README commands, and tests synchronized with the package and executable names.
- Keep `plan` as the default command and `apply` as the only command that mutates Nowledge Mem or source tiddlers. Keep `--mode sync|migrate` exclusive to `plan`, save it in the plan, and default it to `sync`. Do not restore the legacy `--apply` flag.
- Present every user and agent workflow in Terraform order: run and review `plan [options]`, then run bare `apply`.
- Keep all selection, identity, connection, and concurrency options exclusive to `plan`; reject them on `apply`.
- Keep `--report` and `--preview-dir` unsupported. The CLI may create only `.tiddlynmem/plan.json`; it must not create report or converted-Markdown files.
- Keep `--tag` as a single exact, case-sensitive input filter unless a deliberate CLI contract change updates tests and documentation.
- Keep `--wiki-id` as the portable Wiki identity override and preserve its resolved value in native Memory metadata.
- Keep `-V` and `--version` available outside a TiddlyWiki directory, with the value read from the installed `package.json`.
- Preserve the historical `tiddlywiki-nmem-importer` string used by `stableMemoryId`; it is an ID compatibility namespace, not the current product name. Changing it would duplicate previously imported Memories.

## Architecture constraints

Keep TiddlyWiki execution in the child worker. TiddlyWiki boot diagnostics must not be mixed with structured tiddler records; records travel through IPC and stderr is collected separately.

Before any `apply` network request, load the saved plan, rescan and classify the Wiki with its stored options, and verify the exact planned Memory IDs and content fingerprints. Reject missing, malformed, version-mismatched, wrong-directory, or drifted plans. Scan before checking Nowledge Mem health, skip the health check when no tiddlers are ready, and send no Memory requests when verification or preflight fails. Preserve a valid plan after transient apply failures so it can be retried; remove it after a completely successful apply.

The saved plan is an internal execution artifact, not a report. Write it atomically with owner-only permissions. Store the resolved options, package version, Wiki path fingerprint, Memory IDs, and SHA-256 content fingerprints. Never store tiddler bodies, source tags, API keys, or raw API responses in it. Starting a new `plan` must discard any previous saved plan so a failed plan cannot leave an older plan eligible for apply.

Source handling is a post-upsert phase. Collect only titles, canonical `nowledgemem://memory/<id>` URIs, self-describing payload-and-destination digests, and body-free source snapshot digests whose Memory REST request succeeded; send them over IPC instead of command-line arguments. In sync mode, persist state serially through TiddlyWiki's file serializer. In migrate mode, start deletion only when every planned Memory write succeeded, then delete sources serially. Immediately before each write or deletion, compare the raw source file with the apply scan snapshot; reject drift instead of saving a stale snapshot or deleting an edited source. The worker must preserve source text and `modified` during sync and treat already-current state as success. Only rewrite or delete regular `application/x-tiddler` files or independently editable files with an existing `.meta` sidecar; fail safely for shared or unsupported formats. A source-operation failure must be visible in terminal output and produce an unsuccessful exit without misreporting the already completed Memory write.

Conversion behavior is type-dependent:

- `text/vnd.tiddlywiki` and the empty/default type are rendered by TiddlyWiki before Turndown conversion.
- `text/markdown` retains its source Markdown after media safety processing; `text/plain` uses its source text directly.
- A per-tiddler rendering error or empty converted Markdown is listed and counted as `skipped:render` or `skipped:conversion`. It must not prevent a plan from being saved or unrelated planned Memories from being applied, and its source must be retained.
- Unsupported binary types, system tiddlers, drafts, empty tiddlers, and sensitive-title tiddlers are classified and listed instead of upserted. Unchanged synced tiddlers are skipped only in sync mode; migrate mode re-upserts them before source deletion.

Memory content is the converted Markdown body without importer front matter. Sanitize embedded data-URI images in inline Markdown images, full/collapsed/shortcut reference images, and raw HTML images with quoted or unquoted `src` attributes. Print preserved local image references as warnings. Map every source tag except the importer-owned `$:/NowledgeMem` marker to a native Memory label, and preserve Wiki identity, source Wiki, original title, those exact user tags, created time, and modified time in the native Memory `metadata` object. Use `source: "tiddlywiki"` and `source_app: "tiddlynmem"`. Nowledge Mem owns its lifecycle `created_at` and `updated_at`; do not misuse event dates as source-file timestamps.

Validate native Memory request limits during `plan`: title length is at most 200 Unicode characters and content length is at most 32,768 Unicode characters. Report a validation failure instead of truncating, splitting, or sending an invalid request. Retry only transient network failures, request timeouts, HTTP 408, HTTP 429, and HTTP 5xx responses. Bound workers and HTTP calls with timeouts.

Send Memory content only in the REST request body. Do not place note content or API credentials in command-line arguments or logs.

## Setup

```bash
mise trust && mise install
npm ci
```

The repository pins its Node, Nub, npm package, and TypeScript toolchain through `mise.toml`, `package.json`, and `package-lock.json`. Nowledge Mem is an external REST service and its CLI is not a project dependency.

## Required validation

Run these commands after every source or test change:

```bash
npm run typecheck
npm test
npm run build
npm run check:package
```

For CLI behavior involving Wiki discovery or rendering, also run `plan` from `test/fixtures/wiki` or another disposable Wiki root. Never run `apply` against the user's real Nowledge Mem in tests or validation unless the user explicitly authorizes those writes; apply tests must use a disposable fake API.

Tests must cover behavior, not implementation details. Add or update tests when changing:

- CLI options and defaults
- saved-plan creation, validation, drift rejection, retry behavior, and successful consumption
- exact tag input filtering with and without `--tag`
- tag filtering before WikiText rendering
- tiddler classification
- WikiText/HTML/Markdown conversion
- non-blocking per-tiddler render and conversion skips
- deterministic IDs or metadata
- default and explicit portable Wiki identities, including same-named Wiki directories
- API URL precedence, direct service health checks, remote endpoint support, and REST request fields
- native title/content limits, transient retry classification, and request timeouts
- Markdown data-URI omission and local-media warnings
- worker IPC and multiline content
- worker credential isolation and apply preflight output
- post-upsert source URI/digest writeback, migrate-mode deletion, API-failure deletion deferral, standalone and sidecar file deletion, shared-file refusal, legacy-marker migration, change detection, rename-stable updates, idempotence, concurrent-edit rejection, and source-text/modified preservation
- npm package name, executable mapping, and packed CLI startup

Every GitHub Actions `uses:` reference must be pinned to a full commit SHA with the readable action version in an inline comment.

## Contribution workflow

1. Read `README.md`, this file, and the source files relevant to the requested behavior.
2. Inspect the repository for all references before changing a public option, output field, ID algorithm, label, or conversion rule.
3. Keep the patch scoped to the request and preserve unrelated user changes.
4. Update tests and user documentation in the same change when behavior changes.
5. Run typecheck and the full test suite.
6. Review the final diff for generated files, note content, credentials, and accidental dependency changes.
7. Do not commit, push, publish, or create a pull request unless the user explicitly asks.

## Release workflow

- Use Semantic Versioning. For npm version `X.Y.Z`, use `vX.Y.Z` as the corresponding Git tag and GitHub Release name.
- Update `CHANGELOG.md` before a release and keep an empty `Unreleased` section above the released version.
- Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:package`, and `npm publish --dry-run` from a clean checkout of the release commit.
- The first npm publication was performed interactively by an npm maintainer with account-level 2FA. Future versions publish through `.github/workflows/publish-npm.yml` after the corresponding GitHub Release is published.
- Keep the npm Trusted Publisher bound to GitHub user `ThaddeusJiang`, repository `tiddlynmem`, workflow filename `publish-npm.yml`, no environment, and only the `npm publish` allowed action.
- The publish workflow must use OIDC without `NPM_TOKEN`, validate the release tag against `package.json`, publish stable releases to `latest`, and publish GitHub prereleases to `next`.
- While the GitHub repository is private, npm Trusted Publishing remains available but npm provenance cannot be generated.
- Never publish, create a tag, create a GitHub Release, or change repository visibility without explicit user authorization.

## Documentation contract

Every project must contain both files:

- `README.md`: written for human users, centered on setup and practical usage.
- `AGENTS.md`: written for AI coding agents, centered on architecture, development constraints, validation, and contribution.

End every repository README with author information and a License section. Add an Acknowledgements section before them when people, projects, or communities deserve credit.

Use Apache-2.0 as the default license for this and future user-owned projects unless the user explicitly selects another license or an existing project has a deliberate incompatible licensing decision. Keep `LICENSE`, package metadata, README attribution, and acknowledgements synchronized.

When project behavior changes, update the relevant sections rather than allowing either document to become historical or aspirational.
