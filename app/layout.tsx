import type { Metadata } from "next";
import "./globals.css";
import FirstRunGuard from "@/components/FirstRunGuard";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import "@fontsource/gentium-plus/greek-400.css";
import "@fontsource/gentium-plus/greek-ext-400.css";
import "@fontsource/gentium-plus/latin-400.css";

export const metadata: Metadata = {
  title: "Structura — Visual Bible Analysis",
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
      </head>
      <body className="antialiased">
        <LocaleProvider>
          <FirstRunGuard>{children}</FirstRunGuard>
        </LocaleProvider>
      </body>
    </html>
  );
}
