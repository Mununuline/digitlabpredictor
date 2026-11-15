import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DigitLab Predictor | Deriv Last-Digit Analysis",
  description: "Research-first live last-digit analysis for Deriv synthetic indices."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}