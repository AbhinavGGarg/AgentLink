import { Message } from "@prisma/client";
import { env } from "@/lib/env";
import { findBlockedContent, SAFETY_REFUSAL_MESSAGE } from "@/lib/safety";

type AgentConfig = {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  temperature: number;
};

type GenerateReplyInput = {
  agent: AgentConfig;
  history: Array<
    Message & {
      senderUser?: { username: string } | null;
      senderAgent?: { name: string } | null;
    }
  >;
  triggerMessage: Message & {
    senderUser?: { username: string } | null;
    senderAgent?: { name: string } | null;
  };
};

function senderLabel(message: {
  senderType: "human" | "agent";
  senderUser?: { username: string } | null;
  senderAgent?: { name: string } | null;
}) {
  if (message.senderType === "human") {
    return message.senderUser?.username ?? "Human";
  }
  return message.senderAgent?.name ?? "Agent";
}

function inferPromptStyle(systemPrompt: string) {
  const prompt = systemPrompt.toLowerCase();
  const styleHints: string[] = [];

  if (prompt.includes("friendly") || prompt.includes("warm")) {
    styleHints.push("friendly");
  }
  if (prompt.includes("formal") || prompt.includes("professional")) {
    styleHints.push("professional");
  }
  if (prompt.includes("funny") || prompt.includes("humor") || prompt.includes("playful")) {
    styleHints.push("playful");
  }
  if (prompt.includes("short") || prompt.includes("concise")) {
    styleHints.push("concise");
  }

  return styleHints;
}

function applyStyleToReply(reply: string, styleHints: string[]) {
  if (styleHints.length === 0) {
    return reply;
  }

  if (styleHints.includes("concise")) {
    return reply.split(/\s+/).slice(0, 28).join(" ");
  }

  if (styleHints.includes("professional")) {
    return `Certainly. ${reply}`;
  }

  if (styleHints.includes("friendly")) {
    return `${reply} Happy to help more if you want.`;
  }

  if (styleHints.includes("playful")) {
    return `${reply} Quick bonus twist: we can test a creative angle too.`;
  }

  return reply;
}

function normalizeMathExpression(raw: string) {
  return raw
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\btimes\b/g, "*")
    .replace(/\bmultiplied by\b/g, "*")
    .replace(/\bx\b/g, "*")
    .replace(/\bdivided by\b/g, "/")
    .replace(/\bover\b/g, "/")
    .replace(/\^/g, "**")
    .replace(/\s+/g, " ")
    .trim();
}

function trySolveMath(text: string) {
  const lowered = text.trim().toLowerCase();
  const fromQuestion =
    lowered.match(/(?:what is|what's|calculate|compute|solve)\s+(.+?)(?:\?+)?$/i)?.[1] ?? lowered;
  const expression = normalizeMathExpression(fromQuestion).replace(/=\s*$/, "");

  if (!expression || !/[0-9]/.test(expression)) {
    return null;
  }

  if (!/^[0-9+\-*/().% ]+$/.test(expression)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)() as unknown;
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return null;
    }

    const pretty = Number.isInteger(result)
      ? String(result)
      : result.toFixed(8).replace(/\.?0+$/, "");
    return `The answer is ${pretty}.`;
  } catch {
    return null;
  }
}

function buildSummaryFromHistory(input: GenerateReplyInput) {
  const recent = input.history
    .slice(-8)
    .map((message) => {
      const author = message.senderType === "human" ? message.senderUser?.username : message.senderAgent?.name;
      return { author: author ?? (message.senderType === "human" ? "Human" : "Agent"), content: message.content };
    })
    .filter((entry) => entry.content.trim().length > 0);

  if (recent.length === 0) {
    return "Summary: No prior messages to summarize yet.";
  }

  const highlights = recent.slice(-3).map((entry) => `- ${entry.author}: ${entry.content.slice(0, 140)}`);
  return `Summary of recent chat:\n${highlights.join("\n")}`;
}

function buildFallbackReply(input: GenerateReplyInput) {
  const prompt = input.agent.systemPrompt.toLowerCase();
  const source = input.triggerMessage.content.trim();
  const lowered = source.toLowerCase();
  const styleHints = inferPromptStyle(input.agent.systemPrompt);

  if (findBlockedContent(source)) {
    return SAFETY_REFUSAL_MESSAGE;
  }

  const solved = trySolveMath(source);
  if (solved) {
    return applyStyleToReply(solved, styleHints);
  }

  if (/^(hi|hello|hey|yo|sup)[!. ]*$/i.test(source)) {
    return applyStyleToReply("Hey! I am here and ready. Ask me anything, and I will do my best to help.", styleHints);
  }

  if (/^(thanks|thank you|thx)[!. ]*$/i.test(source)) {
    return applyStyleToReply("You are welcome. Want to keep going?", styleHints);
  }

  if (prompt.includes("summar")) {
    return applyStyleToReply(buildSummaryFromHistory(input), styleHints);
  }

  if (prompt.includes("debate") || prompt.includes("debater")) {
    return applyStyleToReply(
      "Counterpoint: I see your claim, but we should test assumptions, cite evidence, and compare alternatives before concluding.",
      styleHints,
    );
  }

  if (prompt.includes("chaos")) {
    return applyStyleToReply("Plot twist: let's invert the assumption and test the wild scenario before settling.", styleHints);
  }

  if (lowered.endsWith("?")) {
    return applyStyleToReply(
      "Short answer: I can handle math and structured reasoning in fallback mode. For broad knowledge responses, add an OpenAI API key.",
      styleHints,
    );
  }

  return applyStyleToReply(`My take: ${source.slice(0, 180)}`, styleHints);
}

export async function generateAgentReply(input: GenerateReplyInput) {
  if (!env.OPENAI_API_KEY) {
    return buildFallbackReply(input);
  }

  const messages = [
    {
      role: "system",
      content: `${input.agent.systemPrompt}\n\nKeep responses concise, useful, and safe for multi-agent chat.`,
    },
    ...input.history.map((message) => {
      const name = senderLabel(message);
      const content = `[${name}]: ${message.content}`;
      if (message.senderType === "agent" && message.senderAgent?.name === input.agent.name) {
        return {
          role: "assistant",
          content,
        };
      }

      return {
        role: "user",
        content,
      };
    }),
  ];

  try {
    const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: input.agent.model || env.OPENAI_DEFAULT_MODEL,
        temperature: input.agent.temperature,
        max_tokens: 220,
        top_p: 1,
        messages,
      }),
    });

    if (!response.ok) {
      const reason = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${reason.slice(0, 150)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return buildFallbackReply(input);
    }

    if (findBlockedContent(content)) {
      return SAFETY_REFUSAL_MESSAGE;
    }

    return content;
  } catch (error) {
    console.error("[agent-provider] Falling back after LLM error", error);
    return buildFallbackReply(input);
  }
}
