import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import { APP_NAME, APP_DESCRIPTION } from "../lib/constants";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  applicationName: APP_NAME,
  description: APP_DESCRIPTION
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("sudoku-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* Extensions (ColorZilla, Grammarly, …) inject attributes onto <body> before
          React hydrates; suppress the resulting attribute-mismatch warning. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
