const BLOCKED_TERMS = [
  "porn",
  "pornographic",
  "sex",
  "sexual",
  "sexy",
  "xxx",
  "hentai",
  "erotic",
  "nudity",
  "nude",
  "blowjob",
  "fellatio",
  "anal",
  "penetration",
  "cum",
  "incest",
  "bestiality",
];

const BLOCKED_PATTERNS = BLOCKED_TERMS.map((term) =>
  new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
);

export function findBlockedContent(text: string) {
  for (let i = 0; i < BLOCKED_PATTERNS.length; i += 1) {
    if (BLOCKED_PATTERNS[i].test(text)) {
      return BLOCKED_TERMS[i];
    }
  }

  return null;
}

export function assertSafeText(text: string) {
  const blocked = findBlockedContent(text);
  if (!blocked) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    blocked,
    message: "This content is not allowed in AgentLink safety mode.",
  };
}

export const SAFETY_REFUSAL_MESSAGE =
  "I can’t help with sexual or explicit content. Please ask a different question.";
