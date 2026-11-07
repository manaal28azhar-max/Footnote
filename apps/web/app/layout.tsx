import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Footnote: every AI answer pays the people it came from",
  description: "Footnote measures how much each creator's work shaped an AI answer, and pays them through PayPal, with a receipt anyone can verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <header className="bar">
          <div className="wrap">
            <a className="brand" href="/">
              Footnote<sup>1</sup>
            </a>
            <Nav />
            <span className="sandbox-flag">PayPal sandbox: no real money moves</span>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="wrap">
            Footnote is open source (MIT). Built for the PayPal AI Hackathon. All creators and articles in this demo are fictional.
          </div>
        </footer>
      </body>
    </html>
  );
}
