import { RoomAgent } from "@prisma/client";
import { env } from "@/lib/env";
import { messageWithSenderInclude, toChatMessage } from "@/lib/messages";
import { prisma } from "@/lib/prisma";
import { dequeueAgentJob, enqueueAgentJob, getQueueSize } from "@/lib/queue/agent-queue";
import { emitAgentThinking, emitMessage } from "@/lib/socket/emitter";
import { generateAgentReply } from "@/lib/agents/provider";

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampResponse(content: string) {
  return content.trim().slice(0, env.MAX_MESSAGE_LENGTH);
}

function isRateLimited(roomAgent: RoomAgent, now: Date, maxResponsesPerMinute: number) {
  if (!roomAgent.responseWindowStart) {
    return false;
  }

  const elapsed = now.getTime() - roomAgent.responseWindowStart.getTime();
  if (elapsed >= 60_000) {
    return false;
  }

  return roomAgent.responseCount >= maxResponsesPerMinute;
}

function isInCooldown(roomAgent: RoomAgent, now: Date, cooldownSeconds: number) {
  if (!roomAgent.lastResponseAt) {
    return false;
  }

  const elapsed = now.getTime() - roomAgent.lastResponseAt.getTime();
  return elapsed < cooldownSeconds * 1000;
}

async function processNextJob() {
  if (processing) {
    return;
  }

  const job = dequeueAgentJob();
  if (!job) {
    return;
  }

  processing = true;

  try {
    const triggerMessage = await prisma.message.findUnique({
      where: { id: job.triggerMessageId },
      include: messageWithSenderInclude,
    });

    if (!triggerMessage) {
      return;
    }

    const roomAgents = await prisma.roomAgent.findMany({
      where: {
        roomId: job.roomId,
        enabled: true,
        agent: {
          enabled: true,
        },
        ...(job.forceAgentId ? { agentId: job.forceAgentId } : {}),
      },
      include: {
        agent: true,
      },
      orderBy: {
        joinedAt: "asc",
      },
    });

    if (roomAgents.length === 0) {
      return;
    }

    const recentMessages = await prisma.message.findMany({
      where: { roomId: job.roomId },
      include: messageWithSenderInclude,
      orderBy: { createdAt: "desc" },
      take: 80,
    });

    const chronologicalHistory = [...recentMessages].reverse();

    for (const roomAgent of roomAgents) {
      const now = new Date();

      if (triggerMessage.senderType === "agent" && triggerMessage.senderAgentId === roomAgent.agentId) {
        continue;
      }

      if (
        roomAgent.agent.respondOnlyWhenMentioned &&
        !new RegExp(`@${escapeRegExp(roomAgent.agent.name)}`, "i").test(triggerMessage.content)
      ) {
        continue;
      }

      if (isInCooldown(roomAgent, now, roomAgent.agent.cooldownSeconds)) {
        continue;
      }

      if (isRateLimited(roomAgent, now, roomAgent.agent.maxResponsesPerMinute)) {
        continue;
      }

      const history = chronologicalHistory.slice(-Math.max(roomAgent.agent.memorySize, 1));

      emitAgentThinking({
        roomId: job.roomId,
        agentId: roomAgent.agentId,
        agentName: roomAgent.agent.name,
        thinking: true,
      });

      const generated = await generateAgentReply({
        agent: {
          id: roomAgent.agent.id,
          name: roomAgent.agent.name,
          systemPrompt: roomAgent.agent.systemPrompt,
          model: roomAgent.agent.model,
          temperature: roomAgent.agent.temperature,
        },
        history,
        triggerMessage,
      });

      emitAgentThinking({
        roomId: job.roomId,
        agentId: roomAgent.agentId,
        agentName: roomAgent.agent.name,
        thinking: false,
      });

      const content = clampResponse(generated);
      if (!content) {
        continue;
      }

      const latestMessages = chronologicalHistory.slice(-8);
      const duplicate = latestMessages.some(
        (message) =>
          message.senderType === "agent" &&
          message.senderAgentId === roomAgent.agentId &&
          message.content.trim().toLowerCase() === content.toLowerCase(),
      );

      if (duplicate || content.toLowerCase() === triggerMessage.content.trim().toLowerCase()) {
        continue;
      }

      const windowElapsed = roomAgent.responseWindowStart
        ? now.getTime() - roomAgent.responseWindowStart.getTime()
        : Number.POSITIVE_INFINITY;
      const nextWindowStart = windowElapsed >= 60_000 ? now : roomAgent.responseWindowStart ?? now;
      const nextResponseCount = windowElapsed >= 60_000 ? 1 : roomAgent.responseCount + 1;

      const created = await prisma.message.create({
        data: {
          roomId: job.roomId,
          senderType: "agent",
          senderAgentId: roomAgent.agentId,
          content,
        },
        include: messageWithSenderInclude,
      });

      await prisma.roomAgent.update({
        where: { id: roomAgent.id },
        data: {
          lastResponseAt: now,
          responseWindowStart: nextWindowStart,
          responseCount: nextResponseCount,
        },
      });

      emitMessage(job.roomId, toChatMessage(created));

      if (job.depth < env.AGENT_MAX_CHAIN_DEPTH) {
        enqueueAgentJob({
          roomId: job.roomId,
          triggerMessageId: created.id,
          depth: job.depth + 1,
        });
      }
    }
  } catch (error) {
    console.error("[agent-worker] Failed job", error);
  } finally {
    processing = false;
  }
}

export function startAgentWorker() {
  if (workerTimer) {
    return;
  }

  workerTimer = setInterval(() => {
    if (!processing && getQueueSize() > 0) {
      void processNextJob();
    }
  }, 600);
}
