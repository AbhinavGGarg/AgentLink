import { FriendshipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getAcceptedFriendUserIds(userId: string) {
  const links = await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.accepted,
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: {
      requesterId: true,
      addresseeId: true,
    },
  });

  return links.map((link) => (link.requesterId === userId ? link.addresseeId : link.requesterId));
}

export async function areUsersFriends(userAId: string, userBId: string) {
  if (userAId === userBId) {
    return true;
  }

  const friendship = await prisma.friendship.findFirst({
    where: {
      status: FriendshipStatus.accepted,
      OR: [
        { requesterId: userAId, addresseeId: userBId },
        { requesterId: userBId, addresseeId: userAId },
      ],
    },
    select: { id: true },
  });

  return Boolean(friendship);
}
