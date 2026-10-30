# AccessLearn

AccessLearn turns pasted study notes or text-based PDFs into simple summaries, flashcards, and practice questions. Generated material can be read aloud with the browser's built-in speech synthesis. Recent documents are stored locally in the browser. The dashboard includes sample notes for trying the flow and a searchable recent library.

## Run locally

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` to a Google AI Studio Gemini API key.
4. Run `npm run dev`, then open `http://localhost:3000`.

The API key is used only by the server-side generation routes. Do not add it to client-side code.

## MVP notes

- PDF text extraction runs in the browser. Scanned/image-only PDFs need OCR and are not supported.
- PDF files are limited to 15 MB; source material and AI requests are limited to 30,000 characters.
- History is saved in browser `localStorage` on the current device; no account or server-side database is used.
- Speech uses the browser's SpeechSynthesis API. Voice availability varies by device and browser.
- AI generation requires a valid Gemini API key.

## Checks

- `npm run typecheck`
- `npm run build`
