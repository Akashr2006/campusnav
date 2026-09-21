import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

// Better Auth scaffolding: nothing imports this yet (the live auth path is
// `lib/auth/auth.ts`). It only works with a database, so it asserts the client
// rather than handling the unconfigured case.
export const auth = betterAuth({
  database: prismaAdapter(prisma!, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  session: { expiresIn: 60 * 60 * 24 * 7 },
});
