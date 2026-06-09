import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { jwtVerify } from "jose";
import { parse as parseCookies } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./env";
import { getUserById } from "../db";
import type { User } from "../../drizzle/schema";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

async function resolveUser(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  try {
    const rawCookies = req.headers.cookie ?? "";
    const cookies = parseCookies(rawCookies);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;

    const secret = new TextEncoder().encode(ENV.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.userId;
    if (typeof userId !== "number") return null;

    return getUserById(userId);
  } catch {
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const user = await resolveUser(opts.req);
  return { req: opts.req, res: opts.res, user };
}
