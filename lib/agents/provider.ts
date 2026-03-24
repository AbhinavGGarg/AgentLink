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

function buildFallbackReply(input: GenerateReplyInput) {
  const prompt = input.agent.systemPrompt.toLowerCase();
  const source = input.triggerMessage.content.trim();

  if (prompt.includes("summar")) {
    const compact = source.split(/\s+/).slice(0, 24).join(" ");
    return `Summary: ${compact}${source.length > compact.length ? "..." : ""}`;
  }

  if (prompt.includes("debate") || prompt.includes("debater")) {
    return `Counterpoint: I see your angle, but a stronger claim needs evidence and a concrete tradeoff analysis.`;
  }

  if (prompt.includes("chaos")) {
    return `Plot twist: let's invert the assumption and test the wild scenario before settling.`;
  }

  return `I can help with that. My current take: ${source.slice(0, 180)}`;
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
