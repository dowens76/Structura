import { getUltBooks, getVcbBooks } from "@/lib/db/queries";
import LicensesPage from "./LicensesPage";

export const metadata = { title: "Content Licenses — Structura" };

export default function Page() {
  let ultBooks: string[] = [];
  let vcbBooks: string[] = [];
  try {
    ultBooks = getUltBooks();
    vcbBooks = getVcbBooks();
  } catch {
    // DB not initialized yet
  }

  return <LicensesPage ultBooks={ultBooks} vcbBooks={vcbBooks} />;
}
