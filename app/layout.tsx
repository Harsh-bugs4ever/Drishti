import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AccessLearn — Learn at your own pace",
  description:
    "Turn study material into clear summaries, flashcards, practice questions, and spoken explanations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
