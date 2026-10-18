import { execSync } from "node:child_process";

/** Fresh demo day: yesterday closed, today open, Arun's overdue call due 30 minutes ago. */
export default function globalSetup() {
  execSync("pnpm db:seed", { stdio: "inherit" });
}
