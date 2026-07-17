"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/i18n/LocaleContext";

interface LicensesPageProps {
  ultBooks: string[];
  vcbBooks: string[];
}

export default function LicensesPage({ ultBooks, vcbBooks }: LicensesPageProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/"
            className="text-sm hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            ← Home
          </Link>
        </div>
        <h1
          className="text-2xl font-bold mb-8"
          style={{ color: "var(--foreground)", fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          {t("home.contentLicenses")}
        </h1>

        <section className="mb-8">
          <h2
            className="text-base font-semibold mb-3 pb-2 border-b"
            style={{ color: "var(--foreground)", borderColor: "var(--border)" }}
          >
            {t("home.footerBiblesHeading")}
          </h2>
          <div className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            <p>{t("home.footerHebrew")}</p>
            <p>{t("home.footerGreek")}</p>
            <p>{t("home.footerLxx")}</p>
            {ultBooks.length > 0 && <p>{t("home.footerUlt")}</p>}
            {vcbBooks.length > 0 && <p>{t("home.footerVcb")}</p>}
          </div>
        </section>

        <section className="mb-8">
          <h2
            className="text-base font-semibold mb-3 pb-2 border-b"
            style={{ color: "var(--foreground)", borderColor: "var(--border)" }}
          >
            {t("home.footerLexicaHeading")}
          </h2>
          <div className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            <p>{t("home.footerLexBdb")}</p>
            <p>{t("home.footerLexStrongs")}</p>
            <p>{t("home.footerLexUbsHebrew")}</p>
            <p>{t("home.footerLexDodson")}</p>
            <p>{t("home.footerLexAbbottSmith")}</p>
            <p>{t("home.footerLexLsj")}</p>
            <p>{t("home.footerLexUbsGreek")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
