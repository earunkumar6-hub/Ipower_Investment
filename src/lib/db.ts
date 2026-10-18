import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Base client — used by Better Auth and the seed script. */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const immutable = () => {
  throw new Error("Day Book entries are immutable; post a reversal instead");
};

/** App client — Day Book entries can only be created, never changed or removed. */
export const db = prisma.$extends({
  query: {
    dayBookEntry: {
      update: immutable,
      updateMany: immutable,
      upsert: immutable,
      delete: immutable,
      deleteMany: immutable,
    },
  },
});

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
