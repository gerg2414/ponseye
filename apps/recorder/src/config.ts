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

  // How far back the initial seed reaches. The backfill pages through this
  // whole window once at startup, then the forward cursor takes over.
  BITQUERY_BACKFILL_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  // How long a token keeps receiving live price and trade-flow updates after it
  // migrates. Rows older than this stay in the table as historical record.
  BITQUERY_TRACKING_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(48),

  // Bitquery rejects a query outright once an account has too many in flight
  // ("access restricted by session limit"), and every rejection leaves a row
  // unmeasured. One request at a time is the setting that stops that happening.
  BITQUERY_MAX_CONCURRENT_QUERIES: z.coerce.number().int().min(1).max(8).default(1),
  BITQUERY_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(120),
}).superRefine((value, ctx) => {
  // Credentials are optional so the recorder can boot disabled, but if it is
  // switched on without them every query fails one at a time at runtime instead
  // of the process refusing to start.
  if (!value.BITQUERY_MIGRATION_TEST_ENABLED) return;
  for (const key of ["BITQUERY_CLIENT_ID", "BITQUERY_CLIENT_SECRET"] as const) {
    if (!value[key]) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required when BITQUERY_MIGRATION_TEST_ENABLED is true`,
      });
    }
  }
});

export const config = schema.parse(process.env);

export const TRACKING_WINDOW_MS = config.BITQUERY_TRACKING_WINDOW_HOURS * 60 * 60_000;
export const BACKFILL_WINDOW_MS = config.BITQUERY_BACKFILL_HOURS * 60 * 60_000;
