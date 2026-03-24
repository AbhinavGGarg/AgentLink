import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const toggleSchema = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = toggleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid toggle payload.", 400);
  }

  const { id, agentId } = await params;

  const membership = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId: id,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    return fail("Room not found or not joined.", 404);
  }

  const updated = await prisma.roomAgent.update({
    where: {
      roomId_agentId: {
        roomId: id,
        agentId,
      },
    },
    data: {
      enabled: parsed.data.enabled,
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          model: true,
          respondOnlyWhenMentioned: true,
        },
      },
    },
  });

  return ok({
    agent: {
      roomId: id,
      agentId: updated.agentId,
      name: updated.agent.name,
      model: updated.agent.model,
      enabled: updated.enabled,
      respondOnlyWhenMentioned: updated.agent.respondOnlyWhenMentioned,
    },
  });
}
