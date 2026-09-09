import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  DATA_PROVIDER: z.enum(["mock", "kolhood", "chain"]).default("kolhood"),
  UPSTREAM_BASE_URL: z.string().url().default("https://kolhood.io"),
  UPSTREAM_API_KEY: z.string().optional(),
  EXPLORER_BASE_URL: z.string().url().default("https://explorer.robinhood.com"),
  MARKET_DATA_PROVIDER: z.enum(["dexscreener", "none"]).default("dexscreener"),
  MARKET_DATA_CHAIN: z.string().default("robinhood"),
  INTERNAL_SYNC_SECRET: z.string().default(""),
  GUEST_HASH_SALT: z.string().default("analyst-dev-salt"),
  RATE_LIMIT_POSTS_PER_10M: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_COMMENTS_PER_10M: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_RATINGS_PER_HOUR: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_VOTES_PER_HOUR: z.coerce.number().int().positive().default(60),
  COMMENT_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(10),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Server-only, validated environment. Never import from client components. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  const value = parsed.data;
  if (process.env.VERCEL) {
    if (!value.DATABASE_URL) throw new Error("Vercel requires a managed DATABASE_URL");
    if (value.DATA_PROVIDER === "mock" || value.MARKET_DATA_PROVIDER !== "dexscreener") throw new Error("Vercel requires live data providers");
    if (value.INTERNAL_SYNC_SECRET.length < 32 || value.GUEST_HASH_SALT.length < 32) throw new Error("Production secrets must contain at least 32 characters");
    if (!value.NEXT_PUBLIC_APP_URL.startsWith("https://")) throw new Error("Production app URL must use HTTPS");
  }
  if (value.DATABASE_URL === "") value.DATABASE_URL = undefined;
  if (value.DIRECT_URL === "") value.DIRECT_URL = undefined;
  if (value.UPSTREAM_API_KEY === "") value.UPSTREAM_API_KEY = undefined;
  cached = value;
  return value;
}

export function isMockProvider(): boolean {
  return env().DATA_PROVIDER === "mock";
}
