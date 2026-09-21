import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/providers/theme-provider";
import { ToastProvider } from "@/shared/components/ui/toast";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CampusNav — Google Maps for Colleges",
  description:
    "Digital Twin based Indoor + Outdoor Campus Navigation Platform. Real-time, multi-floor navigation.",
  metadataBase: new URL("http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafd" },
    { media: "(prefers-color-scheme: dark)", color: "#090b14" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Applies the stored theme before first paint so dark mode does not flash white. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              try {
                var stored = localStorage.getItem('campusnav-theme');
                // The map palette is designed light; default there rather than
                // following the OS, which flipped the whole app to dark.
                var theme = stored === 'light' || stored === 'dark' ? stored : 'light';
                document.documentElement.classList.toggle('dark', theme === 'dark');
                document.documentElement.style.colorScheme = theme;
              } catch (e) {}
            })();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
