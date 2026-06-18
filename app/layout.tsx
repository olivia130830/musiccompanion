import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MusicCompanion",
  description: "音乐发生的时候，也有人听见。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}