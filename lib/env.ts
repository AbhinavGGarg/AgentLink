function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  OPENAI_DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL ?? "gpt-4o-mini",
  SESSION_TTL_HOURS: toPositiveInt(process.env.SESSION_TTL_HOURS, 168),
  MAX_MESSAGE_LENGTH: toPositiveInt(process.env.MAX_MESSAGE_LENGTH, 2000),
  AGENT_MAX_CHAIN_DEPTH: toBoundedInt(process.env.AGENT_MAX_CHAIN_DEPTH, 3, 1, 8),
} as const;
