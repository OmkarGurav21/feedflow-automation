import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  MAX_LIKES_PER_CYCLE: z.coerce.number().int().min(1).max(50).default(5),
  HEADLESS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  PORT: z.coerce.number().int().positive().default(3001),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;

export const HASHTAG_MAP: Record<string, string[]> = {
  ai: ["ai", "artificialintelligence", "machinelearning"],
  technology: ["technology", "tech", "innovation"],
  startups: ["startups", "startup", "entrepreneurship"],
  business: ["business", "entrepreneur"],
  finance: ["finance", "investing", "money"],
  fitness: ["fitness", "workout", "gym"],
  health: ["health", "wellness", "healthyliving"],
  education: ["education", "learning", "knowledge"],
  travel: ["travel", "wanderlust", "adventure"],
  gaming: ["gaming", "games", "gamer"],
};
