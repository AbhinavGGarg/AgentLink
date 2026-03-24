import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-4o-mini"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(2000),
  AGENT_MAX_CHAIN_DEPTH: z.coerce.number().int().min(1).max(8).default(3),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL,
  SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS,
  MAX_MESSAGE_LENGTH: process.env.MAX_MESSAGE_LENGTH,
  AGENT_MAX_CHAIN_DEPTH: process.env.AGENT_MAX_CHAIN_DEPTH,
});
