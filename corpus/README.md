# Corpus

14 Neville Goddard books (public domain), shipped as extracted `.txt`. These are
what `ingest.mjs` reads to build the knowledge graph.

The source `.pdf` files are **not** committed (≈21 MB). If you want them, they are
freely available editions (e.g. Global Grey, archive.org). To regenerate `.txt`
from a PDF you've added:

```bash
brew install poppler          # macOS; apt: poppler-utils
pdftotext your-book.pdf your-book.txt
```

## Adding more

Neville left 350+ lectures — adding them enriches the graph.

1. Drop `something.txt` (or a PDF + `pdftotext`) in this folder.
2. (Optional) add a nice title to the `TITLES` map in `../ingest.mjs`; otherwise
   the filename is used.
3. `node ../ingest.mjs` — only new/changed docs get processed.

`ingest.mjs` strips page numbers, form-feeds, and publisher boilerplate before
ingest so they don't become spurious graph entities.
