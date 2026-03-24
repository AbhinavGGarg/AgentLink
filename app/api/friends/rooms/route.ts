import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { getAcceptedFriendUserIds } from "@/lib/friends";
import { toRoomSummary } from "@/lib/messages";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const friendIds = await getAcceptedFriendUserIds(user.id);
  if (friendIds.length === 0) {
    return ok({ rooms: [] });
  }

  const rooms = await prisma.room.findMany({
    where: {
      createdById: { in: friendIds },
      friendsCanView: true,
    },
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
    orderBy: {
      createdAt: "desc",
    },
  });

  return ok({
    rooms: rooms.map((room) => ({
      ...toRoomSummary(room),
      isFriendView: true,
    })),
  });
}
