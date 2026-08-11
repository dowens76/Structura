import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import FirstRunGuard from "@/components/FirstRunGuard";
import FontSettingsApplier from "@/components/FontSettingsApplier";
import UiFontSizeApplier from "@/components/UiFontSizeApplier";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { SessionHistoryProvider } from "@/components/navigation/SessionHistoryContext";
import "@fontsource/gentium-plus/greek-400.css";
import "@fontsource/gentium-plus/greek-ext-400.css";
import "@fontsource/gentium-plus/latin-400.css";

export const metadata: Metadata = {
  title: "Structura — A Workbench for Study of Scripture",
  description: "Visual analysis of Hebrew and Greek biblical texts with morphological data",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set theme class before first paint to avoid flash.
            suppressHydrationWarning: this is a one-time, idempotent bootstrap
            script (reads localStorage, sets a class) — nothing here depends
            on matching server-rendered content, so a hydration mismatch here
            is always either irrelevant or caused by something outside our
            control (e.g. a browser extension injecting a script into <head>
            before React hydrates, which shifts sibling ordering). */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='light'){document.documentElement.classList.add('light')}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        {/* Apply custom font settings before first paint to avoid flash.
            Reads structura:fontSettings from localStorage (written by
            FontSettingsApplier after the first API fetch) and sets the
            --hebrew-font-family / --greek-font-family / --translation-font-family /
            --transliteration-font-family CSS variables on <html> immediately. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            // q() mirrors toCssFontFamily from lib/fonts.ts:
            // multi-word bare names must be quoted so CSS sees  "SBL Hebrew"
            // rather than two separate names  SBL  and  Hebrew .
            __html: `(function(){function q(v){v=(v||'').trim();if(!v||v.includes('"')||v.includes("'")||v.includes(','))return v;if(v==='inherit'||v==='initial'||v==='unset'||v==='revert')return v;return /\s/.test(v)?'"'+v+'"':v;}try{var s=JSON.parse(localStorage.getItem('structura:fontSettings')||'{}');var r=document.documentElement;if(s.hebrew)r.style.setProperty('--hebrew-font-family',q(s.hebrew));if(s.greek)r.style.setProperty('--greek-font-family',q(s.greek));if(s.translation)r.style.setProperty('--translation-font-family',q(s.translation));if(s.transliteration)r.style.setProperty('--transliteration-font-family',q(s.transliteration));}catch(e){}})()`,
          }}
        />
        {/* Apply interface font-size preset before first paint to avoid flash. */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var pct={sm:87.5,md:100,lg:112.5,xl:125};var v=localStorage.getItem('structura:uiFontSize');if(v&&pct[v]!=null){document.documentElement.style.fontSize=pct[v]+'%';}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <LocaleProvider>
          <Suspense>
            <SessionHistoryProvider>
              <FontSettingsApplier />
              <UiFontSizeApplier />
              <FirstRunGuard>{children}</FirstRunGuard>
            </SessionHistoryProvider>
          </Suspense>
        </LocaleProvider>
      </body>
    </html>
  );
}
