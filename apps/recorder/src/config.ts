import { z } from "zod";

const schema = z.object({
  BITQUERY_CLIENT_ID: z.string().min(1),
  BITQUERY_CLIENT_SECRET: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  GMGN_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const config = schema.parse(process.env);
