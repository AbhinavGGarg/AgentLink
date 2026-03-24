import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { toRoomSummary } from "@/lib/messages";
import { prisma } from "@/lib/prisma";

const joinSchema = z.object({
  roomId: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = joinSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid join payload.", 400);
  }

  const room = await prisma.room.findUnique({
    where: { id: parsed.data.roomId },
  });

  if (!room) {
    return fail("Room not found.", 404);
  }

  await prisma.roomParticipant.upsert({
    where: {
      roomId_userId: {
        roomId: parsed.data.roomId,
        userId: user.id,
      },
    },
    create: {
      roomId: parsed.data.roomId,
      userId: user.id,
    },
    update: {},
  });

  const hydrated = await prisma.room.findUniqueOrThrow({
    where: { id: parsed.data.roomId },
    include: {
      createdBy: {
        select: {
          username: true,
        },
      },
      _count: {
        select: {
          participants: true,
          roomAgents: true,
        },
      },
    },
  });

  return ok({ room: toRoomSummary(hydrated) });
}
