import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AVERLOCK — Protection rules on Base",
  description: "Rules that protect your funds and enforce financial discipline on Base.",
  other: {
    "base:app_id": "6a7e0a4ec58cd20a9e42162d",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var k='averlock-theme',s=localStorage.getItem(k),t=s==='light'||s==='dark'?s:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})()` }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
