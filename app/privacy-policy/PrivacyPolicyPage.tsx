"use client";

import { useTranslation } from "@/lib/i18n/LocaleContext";
import PageShell from "@/components/ui/PageShell";
import SectionHeading from "@/components/ui/SectionHeading";

export default function PrivacyPolicyPage() {
  const { t } = useTranslation();

  const sections: [string, string][] = [
    ["privacyPolicy.overviewHeading", "privacyPolicy.overviewBody"],
    ["privacyPolicy.personalInfoHeading", "privacyPolicy.personalInfoBody"],
    ["privacyPolicy.noTransmissionHeading", "privacyPolicy.noTransmissionBody"],
    ["privacyPolicy.noTrackingHeading", "privacyPolicy.noTrackingBody"],
    ["privacyPolicy.contactHeading", "privacyPolicy.contactBody"],
  ];

  return (
    <PageShell title={t("home.privacyPolicy")} subtitle={t("privacyPolicy.effectiveDate")}>
      <div className="flex flex-col gap-8">
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <SectionHeading className="mb-2">{t(heading)}</SectionHeading>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {t(body)}
            </p>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
