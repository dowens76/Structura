"use client";

import ImportTranslationDialog from "./ImportTranslationDialog";

interface Props {
  osisBook: string;
  chapter: number;
}

export default function ImportButton({ osisBook, chapter }: Props) {
  return <ImportTranslationDialog osisBook={osisBook} chapter={chapter} />;
}
