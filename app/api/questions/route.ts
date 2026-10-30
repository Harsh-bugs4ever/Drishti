import { NextResponse } from "next/server";
import { generateStudyContent, parseStudyCards } from "@/lib/ai";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const text =
    body && typeof body === "object" && "text" in body && typeof body.text === "string"
      ? body.text.trim()
      : "";

  if (text.length < 20) {
    return NextResponse.json(
      { error: "Please provide at least 20 characters of study material." },
      { status: 400 },
    );
  }
  if (text.length > 30000) {
    return NextResponse.json(
      { error: "This document is too long. Please use a document under 30,000 characters." },
      { status: 413 },
    );
  }

  try {
    const content = await generateStudyContent({ text, kind: "questions" });
    return NextResponse.json({ questions: parseStudyCards(content) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Question generation failed.";
    const status = message.startsWith("AI generation is not configured") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
