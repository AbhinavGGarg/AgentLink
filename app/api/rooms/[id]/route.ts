import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { areUsersFriends } from "@/lib/friends";
import { messageWithSenderInclude, toChatMessage, toRoomAgentSummary } from "@/lib/messages";
import { prisma } from "@/lib/prisma";

const updateRoomSchema = z.object({
  friendsCanView: z.boolean(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
        },
      },
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: {
          joinedAt: "asc",
        },
      },
      roomAgents: {
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
      },
    },
  });

  if (!room) {
    return fail("Room not found.", 404);
  }

  const membership = room.participants.find((participant) => participant.userId === user.id) ?? null;

  let canViewAsFriend = false;
  if (!membership) {
    canViewAsFriend = room.friendsCanView && (await areUsersFriends(user.id, room.createdById));
    if (!canViewAsFriend) {
      return fail("Room not found or access restricted.", 404);
    }
  }

  const messages = await prisma.message.findMany({
    where: {
      roomId: id,
    },
    include: messageWithSenderInclude,
    orderBy: {
      createdAt: "asc",
    },
    take: 200,
  });

  const canManage = room.createdById === user.id;
  const canWrite = Boolean(membership);

  return ok({
    room: {
      id: room.id,
      name: room.name,
      createdById: room.createdBy.id,
      createdByUsername: room.createdBy.username,
      friendsCanView: room.friendsCanView,
      canWrite,
      canManage,
      isFriendView: !canWrite && canViewAsFriend,
    },
    participants: room.participants.map((participant) => participant.user),
    agents: room.roomAgents.map((agent) => toRoomAgentSummary(agent)),
    messages: messages.map((message) => toChatMessage(message)),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = updateRoomSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid room settings payload.", 400);
  }

  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  });

  if (!room) {
    return fail("Room not found.", 404);
  }

  if (room.createdById !== user.id) {
    return fail("Only the room owner can update room settings.", 403);
  }

  const updated = await prisma.room.update({
    where: { id },
    data: {
      friendsCanView: parsed.data.friendsCanView,
    },
    select: {
      id: true,
      friendsCanView: true,
    },
  });

  return ok({
    room: updated,
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  });

  if (!room) {
    return fail("Room not found.", 404);
  }

  if (room.createdById !== user.id) {
    return fail("Only the room owner can delete this chat.", 403);
  }

  await prisma.room.delete({
    where: { id },
  });

  return ok({ deleted: true });
}
