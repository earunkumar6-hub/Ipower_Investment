import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
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
  // Signed out after 10 minutes without activity (every role). A login is renewed at most once a minute,
  // by SessionKeepAlive (clicks, typing, page changes) and by saves; plain page loads can't renew the cookie.
  session: { expiresIn: 600, updateAge: 60 },
  // HTTP on localhost/LAN until HTTPS is set up (see fl_crm_demo.json → lan_later)
  advanced: { useSecureCookies: false },
  // Same-origin requests are trusted whichever address the app is opened on (localhost or the LAN IP),
  // so BETTER_AUTH_URL need not match; other sites' origins are still rejected.
  trustedOrigins: (request) => {
    const host = request?.headers.get("host");
    return host ? [`http://${host}`] : [];
  },
  // A login switched off in Settings → Users can't sign in.
  databaseHooks: {
    session: {
      create: {
        async before(session) {
          const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { active: true } });
          if (!u?.active) throw new APIError("FORBIDDEN", { message: "This login is switched off. Ask the owner." });
        },
        // Shown as "Last sign-in" in Settings → Users.
        async after(session) {
          await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
        },
      },
    },
  },
  plugins: [username(), nextCookies()],
});
