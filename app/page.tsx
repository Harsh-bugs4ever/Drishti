"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import type { StudyCard, StudyDocument, StudyMode } from "@/lib/types";

const HISTORY_KEY = "accesslearn.documents.v1";
const MAX_HISTORY = 8;
const MAX_TEXT_LENGTH = 30000;

const modes: Array<{ id: StudyMode; label: string; icon: string }> = [
  { id: "summary", label: "Simple summary", icon: "Aa" },
  { id: "flashcards", label: "Flashcards", icon: "↔" },
  { id: "questions", label: "Practice questions", icon: "?" },
];

const sampleMaterial =
  "Photosynthesis is the process plants use to make their own food. Green leaves absorb sunlight using chlorophyll. Plants take in carbon dioxide from the air and water from the soil. Using light energy, they turn these into glucose, a type of sugar, and release oxygen into the air. Photosynthesis is important because it provides food for plants and oxygen for many living things.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStudyCards(value: unknown): value is StudyCard[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.question === "string" &&
        typeof item.answer === "string",
    )
  );
}

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: "book" | "upload" | "play" | "pause" | "stop" | "clock" | "check";
  className?: string;
}) {
  const paths = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8m-8 4h8" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
    play: <path d="m8 5 12 7-12 7z" />,
    pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></>,
    stop: <path d="M6 6h12v12H6z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<"pdf" | "text">("text");
  const [mode, setMode] = useState<StudyMode>("summary");
  const [summary, setSummary] = useState("");
  const [flashcards, setFlashcards] = useState<StudyCard[]>([]);
  const [questions, setQuestions] = useState<StudyCard[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [history, setHistory] = useState<StudyDocument[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [speechState, setSpeechState] = useState<"idle" | "playing" | "paused">("idle");
  const [speed, setSpeed] = useState("1");
  const [cardIndex, setCardIndex] = useState(0);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) setHistory(parsed as StudyDocument[]);
      }
    } catch (error) {
      console.error("Unable to load saved AccessLearn history:", error);
      setNotice("Saved history could not be loaded in this browser.");
    } finally {
      setHistoryLoaded(true);
    }

    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error("Unable to save AccessLearn history:", error);
      setNotice("This browser could not save your history. Your current document is still available.");
    }
  }, [history, historyLoaded]);

  const currentCards = mode === "flashcards" ? flashcards : questions;
  const generated = mode === "summary" ? summary : currentCards.length > 0;
  const filteredHistory = history.filter((document) =>
    document.title.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase()),
  );
  const currentSpokenText =
    mode === "summary"
      ? summary
      : currentCards[cardIndex]
        ? `${currentCards[cardIndex].question}. ${answerRevealed ? currentCards[cardIndex].answer : ""}`
        : "";

  function persistDocument(next: Partial<StudyDocument>) {
    const id = activeDocumentId || crypto.randomUUID();
    const document: StudyDocument = {
      document_id: id,
      title: title.trim() || "Untitled study material",
      source_type: sourceType,
      raw_text: text,
      summary: next.summary ?? summary,
      flashcards: next.flashcards ?? flashcards,
      questions: next.questions ?? questions,
      created_at: history.find((item) => item.document_id === id)?.created_at ?? new Date().toISOString(),
    };
    setActiveDocumentId(id);
    setHistory((previous) => [
      document,
      ...previous.filter((item) => item.document_id !== id),
    ].slice(0, MAX_HISTORY));
    return document;
  }

  async function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice("");

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setNotice("Please choose a PDF file.");
      event.target.value = "";
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setNotice("This PDF is larger than 15 MB. Please choose a smaller file.");
      event.target.value = "";
      return;
    }

    setBusy(true);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" "),
        );
      }

      const extracted = pages.join("\n\n").trim();
      if (!extracted) {
        setNotice("No selectable text was found in this PDF. Scanned PDFs need OCR, which is not included in this MVP.");
        return;
      }
      if (extracted.length > MAX_TEXT_LENGTH) {
        setNotice("This PDF contains more than 30,000 characters. Please use a shorter document.");
        return;
      }
      setText(extracted);
      setTitle(file.name.replace(/\.pdf$/i, ""));
      setSourceType("pdf");
      setSummary("");
      setFlashcards([]);
      setQuestions([]);
      setActiveDocumentId("");
      setNotice(`Text extracted from ${file.name}.`);
    } catch (error) {
      console.error("PDF text extraction failed:", error);
      setNotice("We could not read this PDF. Please try another file.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    if (text.trim().length < 20) {
      setNotice("Add at least 20 characters of study material before generating.");
      return;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      setNotice("This document is too long. Please use a document under 30,000 characters.");
      return;
    }

    setBusy(true);
    try {
      const endpoint = mode === "summary" ? "summarise" : mode;
      const response = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "Study material could not be generated. Please try again.";
        throw new Error(message);
      }
      if (mode === "summary" && isRecord(result) && typeof result.summary === "string") {
        setSummary(result.summary);
        persistDocument({ summary: result.summary });
      } else if (mode === "flashcards" && isRecord(result) && isStudyCards(result.flashcards)) {
        setFlashcards(result.flashcards);
        setCardIndex(0);
        setAnswerRevealed(false);
        persistDocument({ flashcards: result.flashcards });
      } else if (mode === "questions" && isRecord(result) && isStudyCards(result.questions)) {
        setQuestions(result.questions);
        setCardIndex(0);
        setAnswerRevealed(false);
        persistDocument({ questions: result.questions });
      } else {
        throw new Error("The server returned an unexpected response. Please try again.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Study material could not be generated. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function speak(textToSpeak: string) {
    if (!textToSpeak || !("speechSynthesis" in window)) {
      setNotice("Read aloud is not supported by this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = Number(speed);
    utterance.lang = "en-US";
    utterance.onstart = () => setSpeechState("playing");
    utterance.onend = () => setSpeechState("idle");
    utterance.onerror = () => {
      setSpeechState("idle");
      setNotice("Audio playback could not start. Please try again.");
    };
    window.speechSynthesis.speak(utterance);
  }

  function toggleSpeech(textToSpeak: string) {
    if (speechState === "playing") {
      window.speechSynthesis.pause();
      setSpeechState("paused");
    } else if (speechState === "paused") {
      window.speechSynthesis.resume();
      setSpeechState("playing");
    } else {
      speak(textToSpeak);
    }
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeechState("idle");
  }

  function openDocument(document: StudyDocument) {
    stopSpeech();
    setText(document.raw_text);
    setTitle(document.title);
    setSourceType(document.source_type);
    setSummary(document.summary);
    setFlashcards(document.flashcards);
    setQuestions(document.questions);
    setActiveDocumentId(document.document_id);
    setMode(document.summary ? "summary" : document.flashcards.length ? "flashcards" : "questions");
    setCardIndex(0);
    setAnswerRevealed(false);
    setNotice(`Opened ${document.title}.`);
    window.document.getElementById("study-workspace")?.scrollIntoView({ behavior: "smooth" });
  }

  const buttonClass =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <main>
      <a className="sr-only z-50 rounded-lg bg-white p-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4" href="#main-content">
        Skip to main content
      </a>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="#" className="flex items-center gap-3 rounded-lg text-ink" aria-label="AccessLearn home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest text-white">
              <Icon name="book" className="h-6 w-6" />
            </span>
            <span className="text-xl font-extrabold tracking-tight">AccessLearn</span>
          </a>
          <nav aria-label="Main navigation" className="flex items-center gap-1">
            <a href="#study-workspace" className="hidden min-h-11 items-center rounded-xl px-3 text-sm font-bold text-ink hover:bg-paper sm:inline-flex">
              Study desk
            </a>
            <a href="#history" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-ink hover:bg-paper">
              <Icon name="clock" className="h-4 w-4" />
              <span className="hidden sm:inline">My library</span>
              <span className="sm:hidden">Library</span>
              <span className="sr-only">, {history.length} saved documents</span>
            </a>
          </nav>
        </div>
      </header>

      <div id="main-content" className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-forest">Your accessible study desk</p>
            <h1 id="welcome-heading" className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              Learn at your own pace.
            </h1>
          </div>
          <a href="#study-workspace" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-forest px-5 text-sm font-bold text-white hover:bg-forest-dark">
            Start a study session
          </a>
        </div>

        <section aria-label="How AccessLearn helps" className="mb-8 grid gap-3 rounded-3xl bg-forest p-5 text-white sm:grid-cols-3 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sm font-extrabold" aria-hidden="true">1</span>
            <div><p className="font-bold">Add your material</p><p className="mt-1 text-sm leading-5 text-white/80">Paste notes or extract text from a PDF.</p></div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sm font-extrabold" aria-hidden="true">2</span>
            <div><p className="font-bold">Choose how to learn</p><p className="mt-1 text-sm leading-5 text-white/80">Get a summary, flashcards, or questions.</p></div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sm font-extrabold" aria-hidden="true">3</span>
            <div><p className="font-bold">Listen and revise</p><p className="mt-1 text-sm leading-5 text-white/80">Read aloud, navigate, and learn your way.</p></div>
          </div>
        </section>

        <div id="study-workspace" className="grid grid-cols-1 scroll-mt-6 items-start gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <section aria-labelledby="material-heading" className="min-w-0 rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf2eb] text-forest" aria-hidden="true">
                <Icon name="book" />
              </span>
              <div>
                <h2 id="material-heading" className="text-xl font-extrabold">Start with your material</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">Paste your notes or choose a text-based PDF.</p>
              </div>
            </div>

            <form onSubmit={handleGenerate}>
              <label htmlFor="document-title" className="mb-2 block text-sm font-bold">Document name <span className="font-normal text-slate-500">(optional)</span></label>
              <input
                id="document-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Introduction to biology"
                className="mb-4 min-h-12 w-full rounded-xl border border-line bg-white px-4 text-base text-ink placeholder:text-slate-500"
              />
              <label htmlFor="study-text" className="mb-2 block text-sm font-bold">Study material</label>
              <textarea
                id="study-text"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setSourceType("text");
                  setSummary("");
                  setFlashcards([]);
                  setQuestions([]);
                  setActiveDocumentId("");
                  setNotice("");
                  stopSpeech();
                }}
                placeholder="Paste your notes or textbook excerpt here…"
                rows={8}
                maxLength={MAX_TEXT_LENGTH}
                className="w-full resize-y rounded-xl border border-line bg-white p-4 text-base leading-7 text-ink placeholder:text-slate-500"
                aria-describedby="text-help text-count"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                <p id="text-help">Saved in this browser after you generate material.</p>
                <p id="text-count" aria-live="polite">{text.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handlePdfChange}
                className="sr-only"
                aria-label="Choose a PDF to extract study material"
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className={`${buttonClass} border border-forest bg-white text-forest hover:bg-[#f2f7f2]`}
                >
                  <Icon name="upload" />
                  Choose a PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setText(sampleMaterial);
                    setTitle("How plants make food");
                    setSourceType("text");
                    setSummary("");
                    setFlashcards([]);
                    setQuestions([]);
                    setActiveDocumentId("");
                    setNotice("Sample study notes are ready. Choose what you would like to make.");
                    stopSpeech();
                  }}
                  className={`${buttonClass} border border-line bg-white text-ink hover:bg-paper`}
                >
                  Try sample notes
                </button>
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-600">PDF up to 15 MB · Scanned PDFs need selectable text.</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Generated with Gemini. Material is saved in this browser.
              </p>

              <fieldset className="mt-6">
                <legend className="mb-3 text-sm font-bold">Choose a study format</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {modes.map((item) => (
                    <label
                      key={item.id}
                      className={`flex min-h-[72px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 transition-colors ${mode === item.id ? "border-forest bg-[#f0f6f0] text-ink" : "border-line text-slate-700 hover:bg-paper"}`}
                    >
                      <input
                        type="radio"
                        name="study-mode"
                        value={item.id}
                        checked={mode === item.id}
                        onChange={() => { stopSpeech(); setMode(item.id); }}
                        className="h-4 w-4 accent-forest"
                      />
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${mode === item.id ? "bg-forest text-white" : "bg-paper text-slate-600"}`} aria-hidden="true">{item.icon}</span>
                      <span className="text-sm font-bold leading-5">{item.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={busy || text.trim().length < 20}
                aria-describedby="generation-help"
                className={`${buttonClass} mt-4 w-full bg-forest text-base text-white hover:bg-forest-dark`}
              >
                {busy ? "Creating your study material…" : `Generate ${mode === "summary" ? "summary" : mode}`}
              </button>
              <p id="generation-help" className="mt-2 text-center text-xs leading-5 text-slate-600">Your material is sent to Gemini to create this study aid.</p>
            </form>

            {notice && (
              <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-[#e4cfae] bg-[#fff8ed] px-4 py-3 text-sm font-medium leading-6 text-[#654417]">
                {notice}
              </p>
            )}
          </section>

          <section aria-labelledby="results-heading" aria-busy={busy} className="min-w-0 min-h-[520px] rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf2eb] text-forest">
                  <Icon name="check" />
                </span>
                <div>
                  <h2 id="results-heading" className="text-xl font-extrabold">Your study space</h2>
                  <p className="mt-1 text-sm text-slate-600">{title || "Your generated material will appear here"}</p>
                </div>
              </div>
              {generated && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf2eb] px-3 py-1.5 text-xs font-bold text-forest">
                  <Icon name="check" className="h-4 w-4" /> Ready to learn
                </span>
              )}
            </div>

            <div className="mb-5 grid grid-cols-3 gap-2" aria-label="Study material formats">
              {modes.map((item) => {
                const hasContent =
                  item.id === "summary"
                    ? Boolean(summary)
                    : item.id === "flashcards"
                      ? flashcards.length > 0
                      : questions.length > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={mode === item.id}
                    onClick={() => {
                      stopSpeech();
                      setMode(item.id);
                    }}
                    className={`flex min-h-[52px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left text-xs font-bold leading-4 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:text-sm ${mode === item.id ? "border-forest bg-[#f0f6f0] text-forest" : "border-line text-slate-700 hover:bg-paper"}`}
                  >
                    <span>{item.label}</span>
                    <span className="mt-1 text-[10px] font-semibold sm:mt-0">
                      {hasContent ? "Ready" : "Not made"}
                    </span>
                  </button>
                );
              })}
            </div>

            {generated ? (
              <div>
                {mode === "summary" ? (
                  <div className="rounded-2xl bg-paper p-5 sm:p-6">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-lg font-extrabold">Simple summary</h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={speechState === "playing" ? "Pause reading aloud" : speechState === "paused" ? "Resume reading aloud" : "Read summary aloud"}
                          onClick={() => toggleSpeech(summary)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-forest px-3 text-sm font-bold text-white hover:bg-forest-dark"
                        >
                          <Icon name={speechState === "playing" ? "pause" : "play"} className="h-4 w-4" />
                          {speechState === "playing" ? "Pause" : speechState === "paused" ? "Resume" : "Listen"}
                        </button>
                        <button type="button" aria-label="Stop reading aloud" onClick={stopSpeech} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 text-sm font-bold hover:bg-paper">
                          <Icon name="stop" className="h-4 w-4" />
                          <span className="sr-only">Stop</span>
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[520px] overflow-y-auto whitespace-pre-wrap text-base leading-8 text-slate-800">{summary}</div>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-paper p-5 sm:p-6">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-extrabold">{mode === "flashcards" ? "Flashcards" : "Practice questions"}</h3>
                        <p className="mt-1 text-sm text-slate-600">Item {cardIndex + 1} of {currentCards.length}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleSpeech(currentSpokenText)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-forest px-3 text-sm font-bold text-white hover:bg-forest-dark"
                          aria-label={`${speechState === "playing" ? "Pause" : speechState === "paused" ? "Resume" : "Read"} ${mode === "flashcards" ? "flashcard" : "question"} aloud`}
                        >
                          <Icon name={speechState === "playing" ? "pause" : "play"} className="h-4 w-4" />
                          {speechState === "playing" ? "Pause" : speechState === "paused" ? "Resume" : "Read aloud"}
                        </button>
                        <button type="button" onClick={stopSpeech} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 text-sm font-bold hover:bg-paper" aria-label="Stop reading aloud">
                          <Icon name="stop" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {currentCards[cardIndex] && (
                      <article aria-live="polite" className="min-h-48 rounded-xl border border-line bg-white p-5">
                        <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-forest">{mode === "flashcards" ? "Question" : `Question ${cardIndex + 1}`}</p>
                        <p className="text-lg font-bold leading-8 text-ink">{currentCards[cardIndex].question}</p>
                        {answerRevealed ? (
                          <div className="mt-5 border-t border-line pt-5">
                            <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-forest">Answer</p>
                            <p className="text-base leading-7 text-slate-700">{currentCards[cardIndex].answer}</p>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setAnswerRevealed(true)} className="mt-5 min-h-11 rounded-lg border border-forest px-4 text-sm font-bold text-forest hover:bg-[#f2f7f2]">
                            Reveal answer
                          </button>
                        )}
                      </article>
                    )}
                    <div className="mt-5 grid grid-cols-2 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                      <button type="button" disabled={cardIndex === 0} onClick={() => { setCardIndex((index) => Math.max(0, index - 1)); setAnswerRevealed(false); }} className={`${buttonClass} justify-self-start border border-line bg-white text-ink hover:bg-paper`}>
                        Previous
                      </button>
                      <label className="flex items-center gap-2 justify-self-end text-sm font-bold sm:justify-self-center">
                        <span className="sr-only">Reading speed</span>
                        <span aria-hidden="true">Speed</span>
                        <select value={speed} onChange={(event) => setSpeed(event.target.value)} className="min-h-10 rounded-lg border border-line bg-white px-2">
                          <option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option>
                        </select>
                      </label>
                      <button type="button" disabled={cardIndex >= currentCards.length - 1} onClick={() => { setCardIndex((index) => Math.min(currentCards.length - 1, index + 1)); setAnswerRevealed(false); }} className={`${buttonClass} col-start-2 justify-self-end bg-forest text-white hover:bg-forest-dark sm:col-start-auto`}>
                        Next
                      </button>
                    </div>
                  </div>
                )}
                {mode === "summary" && (
                  <div className="mt-5 flex justify-end">
                    <label className="flex items-center gap-2 text-sm font-bold">
                      Reading speed
                      <select value={speed} onChange={(event) => setSpeed(event.target.value)} className="min-h-10 rounded-lg border border-line bg-white px-2">
                        <option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            ) : (
            <div className="flex min-h-[340px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-paper px-6 text-center">
                <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-forest shadow-sm" aria-hidden="true"><Icon name="book" className="h-7 w-7" /></span>
              <h3 className="text-lg font-extrabold">{text.length >= 20 ? "Ready when you are." : "Your study material will appear here."}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">
                {text.length >= 20
                  ? `Choose “Generate ${mode === "summary" ? "summary" : mode}” to start. Your material will stay available while you explore other formats.`
                  : "Paste your notes or choose a PDF, then select a study format."}
              </p>
              {text.length >= 20 && (
                <a href="#study-text" className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-forest bg-white px-4 text-sm font-bold text-forest hover:bg-[#f2f7f2]">
                  Go to study material
                </a>
              )}
            </div>
            )}
          </section>
        </div>

        <section id="history" aria-labelledby="history-heading" className="mt-8 scroll-mt-6 rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eaf2eb] text-forest"><Icon name="clock" /></span>
              <div>
                <h2 id="history-heading" className="text-xl font-extrabold">Your recent library</h2>
                <p className="mt-1 text-sm text-slate-600">{history.length} of {MAX_HISTORY} recent documents saved on this device.</p>
              </div>
            </div>
            {history.length > 0 && (
              <label className="w-full sm:max-w-xs">
                <span className="sr-only">Search saved documents</span>
                <input
                  type="search"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search your documents"
                  className="min-h-11 w-full rounded-xl border border-line px-4 text-sm text-ink placeholder:text-slate-500"
                />
              </label>
            )}
          </div>
          {history.length ? filteredHistory.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredHistory.map((document) => (
                <li key={document.document_id}>
                  <button type="button" onClick={() => openDocument(document)} className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-line p-4 text-left hover:border-forest hover:bg-paper">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eaf2eb] text-forest"><Icon name="book" className="h-5 w-5" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink">{document.title}</span>
                      <span className="mt-1 block text-xs text-slate-600">
                        {new Date(document.created_at).toLocaleDateString()} · {document.source_type.toUpperCase()}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-paper px-4 py-5 text-sm text-slate-600">No saved documents match “{historySearch}”. Try a different title.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-paper px-4 py-5">
              <p className="text-sm leading-6 text-slate-600">Your saved study materials will appear here. They stay on this device, so you can pick up where you left off.</p>
              <a href="#study-workspace" className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-forest bg-white px-4 text-sm font-bold text-forest hover:bg-[#f2f7f2]">Start studying</a>
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-line pt-5 text-center text-sm text-slate-600">
          Your study materials are saved only in this browser. You’re in control of your learning.
        </footer>
      </div>
    </main>
  );
}
