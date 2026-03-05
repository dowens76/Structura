import type { Metadata } from "next";
import "./globals.css";
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
