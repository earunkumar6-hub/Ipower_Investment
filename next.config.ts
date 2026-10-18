import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright launches Chromium for PDFs; keep it out of the server bundle.
  serverExternalPackages: ["playwright"],
  // No Next.js dev badge (the "N" button) during demos on the dev server.
  devIndicators: false,
  // Expense bills (photo/PDF, max 5 MB) are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
