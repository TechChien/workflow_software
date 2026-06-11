import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "./providers";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Workflow Builder",
  description: "YAML-backed workflow builder MVP"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
