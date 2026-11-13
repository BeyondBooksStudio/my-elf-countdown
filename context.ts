import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { authenticateRequest, type AuthedUser } from "./supabaseAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AuthedUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Signed-out visitors simply get user = null; protected procedures then refuse them.
  const user = await authenticateRequest(opts.req).catch(() => null);
  return { req: opts.req, res: opts.res, user };
}
