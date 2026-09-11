import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "PonsEye Research",
  description: "PONS launch recorder and research dashboard",
  icons: {
    icon: "/ponseye-screen-icon-mark.png",
    shortcut: "/ponseye-screen-icon-mark.png",
    apple: "/ponseye-screen-icon-mark.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
