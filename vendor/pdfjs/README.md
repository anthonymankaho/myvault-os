# PDF.js

This directory contains the locally hosted browser build of Mozilla PDF.js 6.4.299 (`pdf.mjs` and its matching `pdf.worker.mjs`), plus the CMaps and standard fonts used by the reader.

The AI Group imports only PDF.js's text extraction API. Keep the main module and worker from the same release when updating. WASM assets are omitted because the reader sets `useWasm: false`.

- Project and examples: https://mozilla.github.io/pdf.js/
- API documentation: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
- License: `LICENSE`
