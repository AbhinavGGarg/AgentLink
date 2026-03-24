import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { drainAgentQueue } from "@/lib/agents/worker";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { enqueueAgentJob } from "@/lib/queue/agent-queue";

const respondSchema = z.object({
  roomId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = respondSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid respond payload.", 400);
  }

  const { id } = await params;
  const { roomId } = parsed.data;

  const membership = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    return fail("Room not found or not joined.", 404);
  }

  const roomAgent = await prisma.roomAgent.findUnique({
    where: {
      roomId_agentId: {
        roomId,
        agentId: id,
      },
    },
  });

  if (!roomAgent) {
    return fail("Agent is not part of this room.", 404);
  }

  const latestMessage = await prisma.message.findFirst({
    where: { roomId },
    orderBy: { createdAt: "desc" },
  });

  if (!latestMessage) {
    return fail("Room has no messages yet.", 400);
  }

  enqueueAgentJob({
    roomId,
    triggerMessageId: latestMessage.id,
    depth: 0,
    forceAgentId: id,
  });

  // Serverless fallback: process queue in-request when no long-lived worker exists.
  await drainAgentQueue(16);

  return ok({ queued: true });
}
