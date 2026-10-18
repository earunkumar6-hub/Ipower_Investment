import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { prisma } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  account: { modelName: "authAccount" },
  user: {
    additionalFields: {
      role: { type: "string", input: false },
      tenantId: { type: "string", input: false },
    },
  },
  // HTTP on localhost/LAN until HTTPS is set up (see fl_crm_demo.json → lan_later)
  advanced: { useSecureCookies: false },
  // Same-origin requests are trusted whichever address the app is opened on (localhost or the LAN IP),
  // so BETTER_AUTH_URL need not match; other sites' origins are still rejected.
  trustedOrigins: (request) => {
    const host = request?.headers.get("host");
    return host ? [`http://${host}`] : [];
  },
  plugins: [username(), nextCookies()],
});
