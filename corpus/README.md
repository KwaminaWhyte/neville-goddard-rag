# Corpus

14 Neville Goddard books (public domain), shipped as extracted `.txt`. These are
what `ingest.mjs` reads to build the knowledge graph.

```
corpus/
  manifest.json                 title / year / kind per source file
  neville-goddard_*.txt         the books
  lectures/                     (optional) transcribed lectures, recursed
```

The source `.pdf` files are **not** committed (≈21 MB). If you want them, they are
freely available editions (e.g. Global Grey, archive.org). To regenerate `.txt`
from a PDF you've added:

```bash
brew install poppler          # macOS; apt: poppler-utils
pdftotext your-book.pdf your-book.txt
```

## manifest.json

`manifest.json` maps each file to its metadata:

```json
"neville-goddard_power-of-awareness.txt": {
  "title": "The Power of Awareness (1952)",
  "year": 1952,
  "kind": "book"
}
```

`title` matters most: `ingest.mjs` sends it as LightRAG's `file_source`, LightRAG
stores it as the document's `file_path`, and the app cites **that** string to the
user under each daily process and coach reply. So the title is the citation —
keep it clean, and keep it stable (changing it after ingest leaves the old
citation in the graph until that document is re-ingested).

Keys are paths relative to `corpus/`; lookup also accepts the bare filename or
the filename without `.txt`. `year` is copied from each ebook's own "First
published in …" line rather than inferred — omit it instead of guessing. `kind`
is `book` or `lecture` (anything under `lectures/` defaults to `lecture`).

Titles must be unique — ingest refuses to run on a collision, because LightRAG
identifies documents by `file_path` and two sources sharing one would merge into
a single citation.

## Lectures

`corpus/lectures/` holds ~660 lecture transcripts (unlike the 14 books, these
are **not** committed to git — `.gitignore` excludes `corpus/lectures/`). Their
source sites reserve copyright and don't grant redistribution, so they stay
local-only: on disk and in the local LightRAG index, never pushed. `manifest.json`
entries for them *are* tracked (titles/years are just metadata, not the text
itself). If you clone this repo fresh, `corpus/lectures/` will be empty — the
manifest entries referencing it are inert until you repopulate the directory
yourself.

## Adding more

Neville left 350+ lectures — adding them enriches the graph. They are numerous
and short, so they go in `corpus/lectures/` (subfolders are fine, e.g. by year).

1. Drop `something.txt` in `corpus/` (books) or `corpus/lectures/` (lectures).
2. Add it to `manifest.json`. Skipping this still works — ingest derives a title
   from the filename and warns — but the citation will read `something` instead
   of a real title.
3. Ingest just the new material:

```bash
node ingest.mjs --dry-run                 # see what would be submitted (run from repo root)
node ingest.mjs --skip-existing           # skip docs LightRAG already has
node ingest.mjs --only lectures/1953      # substring match on path or title
node ingest.mjs --only '/lecture-0\d/'    # ...or a /regex/
node ingest.mjs --kind lecture --limit 10 # trickle them in
```

Indexing is hours of local compute for the full corpus, so prefer
`--skip-existing` / `--only` over a bare `node ../ingest.mjs`. A file that fails
is reported and skipped; the run continues and exits non-zero at the end.
Documents LightRAG marked FAILED are retried by `node ../reprocess_failed.mjs`,
not by re-ingesting.

## Cleaning

`ingest.mjs` strips page numbers, form-feeds, decorative `****` rules, `THE END`
markers, and Global Grey publisher boilerplate — including the publisher's
personal afterword at the end of some books (donation appeals and so on), which
would otherwise mint entities like "Julie" and "Amazon" into the graph.
