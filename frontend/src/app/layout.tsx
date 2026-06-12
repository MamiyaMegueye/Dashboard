import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "SNDE — Suivi Temps Réel",
  description: "Dashboard de suivi temps réel des relevés et avancement par secteur (Nouakchott)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
