import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { fail, ok } from "@/lib/api/response";
import { toRoomAgentSummary } from "@/lib/messages";
import { prisma } from "@/lib/prisma";
import { assertSafeText } from "@/lib/safety";

const createAgentSchema = z.object({
  roomId: z.string().min(1),
  name: z.string().min(2).max(40),
  systemPrompt: z.string().min(5).max(3000),
  model: z.string().min(1).default(env.OPENAI_DEFAULT_MODEL),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  memorySize: z.coerce.number().int().min(4).max(60).default(12),
  respondOnlyWhenMentioned: z.boolean().default(false),
  cooldownSeconds: z.coerce.number().int().min(1).max(120).default(8),
  maxResponsesPerMinute: z.coerce.number().int().min(1).max(30).default(6),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = createAgentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid agent payload.", 400);
  }

  const roomMembership = await prisma.roomParticipant.findUnique({
    where: {
      roomId_userId: {
        roomId: parsed.data.roomId,
        userId: user.id,
      },
    },
  });

  if (!roomMembership) {
    return fail("Join the room before adding agents.", 403);
  }

  const promptSafety = assertSafeText(parsed.data.systemPrompt);
  if (!promptSafety.ok) {
    return fail("Agent description contains blocked content.", 400);
  }

  const nameSafety = assertSafeText(parsed.data.name);
  if (!nameSafety.ok) {
    return fail("Agent name contains blocked content.", 400);
  }

  const roomAgent = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        name: parsed.data.name.trim(),
        systemPrompt: parsed.data.systemPrompt.trim(),
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        memorySize: parsed.data.memorySize,
        respondOnlyWhenMentioned: parsed.data.respondOnlyWhenMentioned,
        cooldownSeconds: parsed.data.cooldownSeconds,
        maxResponsesPerMinute: parsed.data.maxResponsesPerMinute,
        createdById: user.id,
      },
    });

    return tx.roomAgent.create({
      data: {
        roomId: parsed.data.roomId,
        agentId: agent.id,
        enabled: true,
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
  });

  return ok({ agent: toRoomAgentSummary(roomAgent) }, 201);
}
