import type { Metadata } from "next";
import "./globals.css";
import FirstRunGuard from "@/components/FirstRunGuard";
import FontSettingsApplier from "@/components/FontSettingsApplier";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
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
        {/* Set theme class before first paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='light'){document.documentElement.classList.add('light')}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        {/* Apply custom font settings before first paint to avoid flash.
            Reads structura:fontSettings from localStorage (written by
            FontSettingsApplier after the first API fetch) and sets the
            --hebrew-font-family / --greek-font-family / --translation-font-family
            CSS variables on <html> immediately. */}
        <script
          dangerouslySetInnerHTML={{
            // q() mirrors toCssFontFamily from lib/fonts.ts:
            // multi-word bare names must be quoted so CSS sees  "SBL Hebrew"
            // rather than two separate names  SBL  and  Hebrew .
            __html: `(function(){function q(v){v=(v||'').trim();if(!v||v.includes('"')||v.includes("'")||v.includes(','))return v;if(v==='inherit'||v==='initial'||v==='unset'||v==='revert')return v;return /\s/.test(v)?'"'+v+'"':v;}try{var s=JSON.parse(localStorage.getItem('structura:fontSettings')||'{}');var r=document.documentElement;if(s.hebrew)r.style.setProperty('--hebrew-font-family',q(s.hebrew));if(s.greek)r.style.setProperty('--greek-font-family',q(s.greek));if(s.translation)r.style.setProperty('--translation-font-family',q(s.translation));}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <LocaleProvider>
          <FontSettingsApplier />
          <FirstRunGuard>{children}</FirstRunGuard>
        </LocaleProvider>
      </body>
    </html>
  );
}
