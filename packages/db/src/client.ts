import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy packages/db/.env.example to .env and fill it in.",
  );
}

/**
 * Next.js re-evaluates modules on every hot reload, which would open a fresh
 * pool each time and exhaust the connection limit within a few edits. Cache the
 * pool on globalThis outside production so reloads reuse one.
 */
const globalForDb = globalThis as unknown as { outreachPool?: Pool };

const pool = globalForDb.outreachPool ?? new Pool({ connectionString });

if (process.env.NODE_ENV !== "production") {
  globalForDb.outreachPool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
