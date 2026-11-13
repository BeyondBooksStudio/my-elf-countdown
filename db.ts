import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Created on first use so tools and tests can run without a database.
export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      const client = postgres(ENV.databaseUrl, {
        // Supabase's "transaction pooler" does not support prepared statements.
        prepare: false,
        ssl: "require",
        // Serverless functions run many small copies, so keep each copy's pool small.
        max: Number(process.env.DATABASE_POOL_MAX ?? 3),
        idle_timeout: 20,
        connect_timeout: 10,
      });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error instanceof Error ? error.message : "unknown error");
      _db = null;
    }
  }
  return _db;
}
