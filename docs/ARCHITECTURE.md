# Architecture

Threads is built around one rule: **metadata eagerly, bodies lazily, parsing once, DOM only for the visible range.**

## Native integration

The message pane integration uses a small Experiment API (`experiment/`). The adapter wraps the message display methods in the existing `about:3pane` document and reuses Thunderbird's message-pane browser, updating the same embedded reader document when the selection changes. It does not alter mailbox data or the folder/thread-list layout.

Native selection handling, folders and the thread list stay under Thunderbird's control. RSS/news, drafts/templates, empty selections and selections spanning separate threads use the native display. A hidden message pane stays hidden. Disabling or unloading Threads restores the original display methods and re-renders the selected message. Each mail tab has its own selection and viewport, and one tab cannot cancel another tab's queued body work.

`build.py` bundles `pane-controller.js` into the Experiment entry point, so no `jar:file:` subscript is loaded at runtime. The integration follows the interfaces in [Thunderbird's MessagePane source](https://github.com/thunderbird/thunderbird-desktop/blob/main/mail/base/content/widgets/message-pane.mjs).

Thunderbird 147 is the minimum because it is the first version with the header-only [`messages.getHeaders()`](https://webextension-api.thunderbird.net/en/beta-mv2/messages.html#getheaders-messageid-options) API. There is deliberately no MIME-parsing fallback for metadata.

## Index

- IndexedDB stores message metadata, topology nodes and edges, normalized bodies and scan checkpoints separately.
- The RFC Message-ID is the logical identity. Thunderbird IDs are runtime-only fetch handles held in a bounded 2,048-entry LRU, and are revalidated before any action. Messages without an RFC ID get a session-scoped fallback and cannot be recovered automatically across restarts.
- A persistent union-find joins reference chains, explicit reply parents and missing-ancestor placeholders. A `rootId` index retrieves a thread's known metadata in one indexed query. Merges rewrite the smaller component's metadata, so late ancestors never require rebuilding the mailbox graph.
- Native thread headers give an immediate conversation skeleton even while the index is incomplete. The selected message and visible body misses receive canonical header reads; background indexing enriches the rest. Missing referenced ancestors are resolved by exact Message-ID queries, capped at 100 per discovery pass. Descendants appear as indexing reaches them, since an ancestor's headers cannot reveal unknown replies.
- Outgoing replies in other folders are found with a header-only query of your sent mail matching the normalized subject, cached for five minutes, then joined strictly by `References`/`In-Reply-To`. Sent copies are indexed immediately after a successful send.
- Scanning runs over the last 30 days, then six months, then older mail. A two-day catch-up query runs every five minutes. New mail, moves, copies and deletions update the index; duplicate copies sharing an RFC ID are one logical message.

## Bodies

- The selected body is queued first. The scheduler deduplicates requests, cancels queued work that left the viewport, and allows at most **three** concurrent `getFull()` calls.
- MIME extraction prefers the HTML alternative (keeping the plain part alongside), and excludes attachments and attached `message/rfc822` parts. Attachment metadata comes from the same MIME tree, so listing attachments costs no extra request; files are fetched only on open, save or preview.
- A module worker parses bodies and computes a SHA-256 source hash. Parsed bodies are reused while the parser version and message size match.
- Caches: mounted rows are L0; an 80-entry, roughly 12 MiB in-memory LRU is L1; IndexedDB is L2, pruned by a cursor toward 100 MiB every five minutes. The disk limit is a serialized-size estimate, not measured disk usage.

## Parser

Original HTML never enters the DOM. `src/parser.js` walks tags in order and reduces a message to text plus private-use sentinel characters for formatting (marks, links, list items, quote depth, block breaks). Sentinels are stripped from every input, including decoded entities, so mail content cannot forge them. Line-based quote and signature detection then runs over that text, and the result is a list of blocks:

- `text` with runs `{text, href?, b?, i?, u?, code?}`
- `list` with items `{depth, marker, text, runs?}`
- `code` with exact whitespace and a language hint
- `attribution` ("On … wrote:") and `headers` (forwarded From/Sent/To/Subject), inside quoted history only

Blocks in quoted history carry a `depth`, derived from `>` prefixes in plain text or `<blockquote>` nesting in HTML. Block elements break lines where they open and close, and adjacent edges merge, matching browser layout. The reader builds fresh elements from these blocks with `textContent`, and only `http`, `https` and `mailto` links without credentials become anchors.

## Reader

- A custom virtual list (no framework) mounts at most **24** cards with 600px of overscan above and below the viewport. Cards sit in normal document flow between two spacers, so they never overlap while heights are measured. Unmeasured cards are estimated from the average of measured ones.
- Scrolling touches the DOM only when the mounted range changes. Unchanged progress, group and spacer state is never rewritten.
- The loading indicator overlays the conversation instead of taking layout space, and image previews use fixed-height tiles, so loading never shifts what you are reading. Spacers and pinned card headers are excluded from scroll anchoring.
- Typography settings are CSS custom properties (`--reading-font`, `--reading-size`, `--reading-leading`) shared with the settings preview.

## Performance targets

To be confirmed in Thunderbird:

| Operation | Target |
| --- | ---: |
| Known thread first paint | <20 ms |
| Uncached metadata | <100 ms |
| Selected body, locally available mail | <150 ms |
| Mounted message rows | ≤24 |
| Concurrent MIME loads | ≤3 |
| Unchanged cached body reparses | 0, unless evicted |
| Full-thread body preload | Never |

The reader records `thread-open`, `metadata-ready`, `first-paint` and `selected-body-ready` performance marks. `first-paint` is a requestAnimationFrame approximation; use the Thunderbird profiler for real paint and long-task measurements.

## Tests

`npm test` runs Node tests against mocked Thunderbird APIs and `fake-indexeddb`. They cover late ancestors, component merges, cycles, concurrent indexing, cache accounting and eviction, MIME selection, inert HTML conversion, formatting, quote structure, line breaks, scheduling, deduplication, restart recovery, the reader's virtual list, menus and attachments, and the native pane adapter. A 500-message mailbox test checks that indexing and opening make **zero MIME or parser calls**.

`npm run benchmark` measures 10 to 2,000-message threads and Outlook, Gmail, giant-quote, newsletter and attachment-heavy fixtures. These are algorithm checks, not Thunderbird timings. `tests/browser.html` runs real IndexedDB and module-worker checks when served locally.

## Source map

| File | Purpose |
| --- | --- |
| `experiment/api.js`, `experiment/pane-controller.js` | Native window/tab lifecycle and in-place message-pane integration |
| `src/background.js` | Per-tab selection, Thunderbird events, indexing, handle resolution, body pipeline, message and attachment actions |
| `src/db.js` | IndexedDB schema, union-find, root lookup, body cache accounting and eviction |
| `src/core.js` | Header identities, metadata, scheduler, LRU, reference-graph helper |
| `src/parser.js`, `src/worker.js` | MIME selection, HTML/text parsing into blocks, attachment listing, worker hashing |
| `src/reader.js`, `src/reader.css` | Virtualized conversation reader |
| `src/message-text.js` | Safe link validation and block rendering |
| `src/card-menu.js`, `src/address-menu.js` | Per-card ⋯ menu and address action menu |
| `src/preferences.js`, `src/options.*` | Shared settings, typography and the settings page |
| `build.py`, `release.py` | XPI packaging; self-hosted release preparation |
