import { Message } from "@prisma/client";
import { env } from "@/lib/env";

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

  const solved = trySolveMath(source);
  if (solved) {
    return solved;
  }

  if (/^(hi|hello|hey|yo|sup)[!. ]*$/i.test(source)) {
    return "Hey! I am here and ready. Ask me anything, and I will do my best to help.";
  }

  if (/^(thanks|thank you|thx)[!. ]*$/i.test(source)) {
    return "You are welcome. Want to keep going?";
  }

  if (prompt.includes("summar")) {
    return buildSummaryFromHistory(input);
  }

  if (prompt.includes("debate") || prompt.includes("debater")) {
    return `Counterpoint: I see your claim, but we should test assumptions, cite evidence, and compare alternatives before concluding.`;
  }

  if (prompt.includes("chaos")) {
    return `Plot twist: let's invert the assumption and test the wild scenario before settling.`;
  }

  if (lowered.endsWith("?")) {
    return "Short answer: I can handle math and structured reasoning in fallback mode. For broad knowledge responses, add an OpenAI API key.";
  }

  return `My take: ${source.slice(0, 180)}`;
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

    return content;
  } catch (error) {
    console.error("[agent-provider] Falling back after LLM error", error);
    return buildFallbackReply(input);
  }
}
