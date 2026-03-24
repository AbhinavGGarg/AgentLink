import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { messageWithSenderInclude, toChatMessage, toRoomAgentSummary } from "@/lib/messages";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const { id } = await params;

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

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
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

  return ok({
    room: {
      id: room.id,
      name: room.name,
    },
    participants: room.participants.map((participant) => participant.user),
    agents: room.roomAgents.map((agent) => toRoomAgentSummary(agent)),
    messages: messages.map((message) => toChatMessage(message)),
  });
}
