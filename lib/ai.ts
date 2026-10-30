type GenerateOptions = {
  text: string;
  kind: "summary" | "flashcards" | "questions";
};

const prompts = {
  summary:
    "Explain this study material in simple language. Use short sentences and clear headings. Keep important facts, explain unfamiliar terms, and avoid jargon. Return plain text, not markdown tables.",
  flashcards:
    'Create 5 to 8 useful study flashcards from this material. Return only a JSON array of objects with exactly "question" and "answer" string properties. Do not include markdown fences.',
  questions:
    'Create 5 practice questions and their correct answers from this material. Return only a JSON array of objects with exactly "question" and "answer" string properties. Do not include markdown fences.',
} satisfies Record<GenerateOptions["kind"], string>;

export async function generateStudyContent({ text, kind }: GenerateOptions) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI generation is not configured yet. Add GEMINI_API_KEY to your environment and restart the app.",
    );
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${prompts[kind]}\n\nStudy material:\n${text}` },
            ],
          },
        ],
        generationConfig:
          kind === "summary"
            ? { temperature: 0.3, maxOutputTokens: 1400 }
            : { temperature: 0.4, maxOutputTokens: 1800, responseMimeType: "application/json" },
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text();
    console.error("Gemini request failed:", response.status, details);
    throw new Error(
      response.status === 401 || response.status === 403
        ? "The AI service rejected the API key. Check GEMINI_API_KEY and try again."
        : "The AI service could not generate study material. Please try again.",
    );
  }

  const result: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  } = await response.json();
  const content = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!content) {
    throw new Error("The AI service returned an empty response. Please try again.");
  }

  return content;
}

export function parseStudyCards(value: string) {
  const normalized = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed: unknown = JSON.parse(normalized);

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.question !== "string" ||
        typeof item.answer !== "string" ||
        !item.question.trim() ||
        !item.answer.trim(),
    )
  ) {
    throw new Error("The AI service returned study cards in an unexpected format. Please try again.");
  }

  return parsed as Array<{ question: string; answer: string }>;
}
