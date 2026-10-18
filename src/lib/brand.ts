import { readFileSync } from "node:fs";
import path from "node:path";

// Letterhead shared by the PDFs and Excel downloads.
export const TAGLINE = "Smart Investments For Good Life";
export const ADVISOR = "R. Murali, Financial Advisor";

/** Company logo, 512px copy so files stay small; read once per server process. */
let logo: Buffer | undefined;
export const logoPng = () => (logo ??= readFileSync(path.join(process.cwd(), "public/logo-512.png")));
