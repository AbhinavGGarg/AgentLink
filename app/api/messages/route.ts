import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { fail, ok } from "@/lib/api/response";
import { drainAgentQueue } from "@/lib/agents/worker";
import { messageWithSenderInclude, toChatMessage } from "@/lib/messages";
import { prisma } from "@/lib/prisma";
import { enqueueAgentJob } from "@/lib/queue/agent-queue";
import { emitMessage } from "@/lib/socket/emitter";

const sendMessageSchema = z.object({
  roomId: z.string().min(1),
  content: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = sendMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid message payload.", 400);
  }

  const roomId = parsed.data.roomId;
  const content = parsed.data.content.trim().slice(0, env.MAX_MESSAGE_LENGTH);

  if (!content) {
    return fail("Message cannot be empty.", 400);
  }

  const membership = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    return fail("Join this room first.", 403);
  }

  const created = await prisma.message.create({
    data: {
      roomId,
      senderType: "human",
      senderUserId: user.id,
      content,
    },
    include: messageWithSenderInclude,
  });

  const payload = toChatMessage(created);
  emitMessage(roomId, payload);

  enqueueAgentJob({
    roomId,
    triggerMessageId: created.id,
    depth: 0,
  });

  // Serverless fallback: process queue in-request when no long-lived worker exists.
  await drainAgentQueue(16);

  return ok({ message: payload }, 201);
}
