import { z } from "zod";

const schema = z.object({
  BITQUERY_CLIENT_ID: z.string().min(1).optional(),
  BITQUERY_CLIENT_SECRET: z.string().min(1).optional(),
  BITQUERY_MIGRATION_TEST_ENABLED: z.string().default("false").transform((value) => value === "true"),
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BITQUERY_MIGRATION_POLL_MS: z.coerce.number().int().min(5000).default(15000),
  BITQUERY_METRICS_POLL_MS: z.coerce.number().int().min(5000).default(5000),
});

export const config = schema.parse(process.env);
