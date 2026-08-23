# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-23

### Added

- Added one-way incremental synchronization from TiddlyWiki to Nowledge Mem. Successful upserts now write `nmem-uri` and a self-describing `nmem-digest: sha256:<hex>` alongside `$:/NowledgeMem`.
- Added reviewed create, update, and legacy-marker migration actions while unchanged synced tiddlers are skipped.
- Preserved the stored Memory ID across tiddler edits and title changes.

### Fixed

- Prevented sync-state writeback from overwriting concurrent source edits, and printed exact per-tiddler scan failures before apply rejects plan drift.

## [0.1.0] - 2026-08-15

### Added

- Added the `tiddlynmem` npm CLI for importing a Node.js TiddlyWiki into Nowledge Mem.
- Added Terraform-style saved-plan execution: `plan` owns all options, while bare `apply` verifies and executes the reviewed plan.
- Added exact TiddlyWiki tag filtering through `--tag`, bounded imports through `--limit`, and concurrent writes through `--jobs`.
- Added WikiText-to-GitHub-Flavored-Markdown conversion using the active TiddlyWiki runtime.
- Added native Nowledge Mem titles, bodies, labels, source fields, stable IDs, and TiddlyWiki metadata.
- Added post-import `$:/NowledgeMem` tagging so successfully imported tiddlers are skipped on later runs.
- Added direct REST health checks, a zero-config local API default, HTTP and HTTPS URL overrides, sensitive-title filtering, and retries without requiring the `nmem` CLI.
- Added body-free plan fingerprints so apply rejects Wiki changes made after planning.

### Fixed

- Prevented same-named Wiki directories from sharing Memory IDs and added `--wiki-id` for an explicit portable identity.
- Prevented TiddlyWiki workers from receiving `NMEM_API_KEY` and omitted raw API response bodies from errors and terminal output.
- Required successful Memory API responses to confirm the requested stable ID before source tiddlers are tagged.
- Rejected health-check and Memory API redirects so tiddler data is never forwarded to an unexpected address.
- Printed `failed:preflight` results when service health checks fail and skipped health checks when an apply has no ready tiddlers.
- Filtered `--tag` selections before WikiText rendering so unrelated tiddlers are not processed.
- Skipped WikiText rendering for drafts, previously imported tiddlers, and sensitive-title tiddlers excluded by default.
- Removed embedded data-URI images from inline, reference, shortcut-reference, and raw HTML Markdown images, and reported preserved local Markdown images.
- Reported native Memory title and content limit failures during `plan` instead of retrying invalid writes during `apply`.
- Limited retries to transient failures and added timeouts for health checks, TiddlyWiki workers, and Memory API requests.
- Preserved non-Latin Wiki directory names in generated source labels.
- Removed the unnecessary `--allow-remote` confirmation flag so explicitly configured endpoints work directly.
- Escaped terminal control characters in tiddler-derived output and diagnostics.
- Added skipped totals and reason counts to terminal summaries.

[Unreleased]: https://github.com/nowledge-co/tiddlynmem/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nowledge-co/tiddlynmem/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nowledge-co/tiddlynmem/releases/tag/v0.1.0
