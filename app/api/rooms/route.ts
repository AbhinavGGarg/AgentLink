import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { toRoomSummary } from "@/lib/messages";
import { prisma } from "@/lib/prisma";

const createRoomSchema = z.object({
  name: z.string().min(2).max(80),
  friendsCanView: z.boolean().optional(),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const memberships = await prisma.roomParticipant.findMany({
    where: { userId: user.id },
    include: {
      room: {
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
      },
    },
    orderBy: {
      joinedAt: "desc",
    },
  });

  return ok({
    rooms: memberships.map((membership) => toRoomSummary(membership.room)),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = createRoomSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid room payload.", 400);
  }

  const room = await prisma.$transaction(async (tx) => {
    const created = await tx.room.create({
      data: {
        name: parsed.data.name.trim(),
        createdById: user.id,
        friendsCanView: parsed.data.friendsCanView ?? true,
      },
    });

    await tx.roomParticipant.create({
      data: {
        roomId: created.id,
        userId: user.id,
      },
    });

    return tx.room.findUniqueOrThrow({
      where: { id: created.id },
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
  });

  return ok({ room: toRoomSummary(room) }, 201);
}
