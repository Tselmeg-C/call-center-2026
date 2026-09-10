import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "antd/dist/reset.css";
import "./globals.css";
import { ServiceProvider } from "../services/provider";

export const metadata: Metadata = {
  title: "Call Center",
  description: "Sales customer-contact management",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry><ServiceProvider>{children}</ServiceProvider></AntdRegistry>
      </body>
    </html>
  );
}
