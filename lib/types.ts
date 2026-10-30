export type StudyCard = {
  question: string;
  answer: string;
};

export type StudyDocument = {
  document_id: string;
  title: string;
  source_type: "pdf" | "text";
  raw_text: string;
  summary: string;
  flashcards: StudyCard[];
  questions: StudyCard[];
  created_at: string;
};

export type StudyMode = "summary" | "flashcards" | "questions";
