"use client";

import { useTranslation } from "@/lib/i18n/LocaleContext";
import PageShell from "@/components/ui/PageShell";
import SectionHeading from "@/components/ui/SectionHeading";

interface LicensesPageProps {
  ultBooks: string[];
  vcbBooks: string[];
}

export default function LicensesPage({ ultBooks, vcbBooks }: LicensesPageProps) {
  const { t } = useTranslation();

  return (
    <PageShell title={t("home.contentLicenses")}>
      <section className="mb-8">
        <SectionHeading bordered className="mb-3">
          {t("home.footerBiblesHeading")}
        </SectionHeading>
        <div className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          <p>{t("home.footerHebrew")}</p>
          <p>{t("home.footerGreek")}</p>
          <p>{t("home.footerLxx")}</p>
          {ultBooks.length > 0 && <p>{t("home.footerUlt")}</p>}
          {vcbBooks.length > 0 && <p>{t("home.footerVcb")}</p>}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading bordered className="mb-3">
          {t("home.footerLexicaHeading")}
        </SectionHeading>
        <div className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          <p>{t("home.footerLexBdb")}</p>
          <p>{t("home.footerLexUbsHebrew")}</p>
          <p>{t("home.footerLexDodson")}</p>
          <p>{t("home.footerLexAbbottSmith")}</p>
          <p>{t("home.footerLexLsj")}</p>
          <p>{t("home.footerLexUbsGreek")}</p>
        </div>
      </section>
    </PageShell>
  );
}
