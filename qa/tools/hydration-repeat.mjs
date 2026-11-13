// Dev aid: loads pages several times on the QA app and shows which element's server / client HTML differ.
import { chromium } from "@playwright/test";
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3100";
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["/customers", "/renewals", "/receipts", "/dashboard"];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
let cur = ""; const hits = [];
p.on("console", (m) => { if (m.type() === "error" && /hydrat/i.test(m.text())) hits.push({ page: cur, text: m.text() }); });
await p.goto(`${BASE}/login`); await p.getByLabel("Username").fill("superadmin"); await p.getByLabel("Password").fill("demo1234");
await p.getByRole("button", { name: /sign in/i }).click(); await p.waitForURL((u) => !u.pathname.startsWith("/login"));
const rounds = Number(process.env.ROUNDS ?? 6);
const tally = {};
for (let r = 0; r < rounds; r++) for (const path of pages) {
  cur = path; const before = hits.length;
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await p.waitForTimeout(500);
  tally[path] = (tally[path] ?? 0) + (hits.length > before ? 1 : 0);
}
console.log("hydration warnings per page over", rounds, "loads:", JSON.stringify(tally));
const first = hits[0]; if (first) console.log("\nfirst one on", first.page, "\n", first.text.split("\n").filter((l) => /^[+-] |<[A-Z][A-Za-z]+/.test(l)).slice(0, 14).join("\n"));
await b.close();
