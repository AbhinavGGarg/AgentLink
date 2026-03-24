import { FriendshipStatus } from "@prisma/client";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const requestFriendSchema = z.object({
  username: z.string().min(3).max(24),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const links = await prisma.friendship.findMany({
    where: {
      OR: [{ requesterId: user.id }, { addresseeId: user.id }],
    },
    include: {
      requester: {
        select: {
          id: true,
          username: true,
        },
      },
      addressee: {
        select: {
          id: true,
          username: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const friends = links
    .filter((link) => link.status === FriendshipStatus.accepted)
    .map((link) => {
      const friend = link.requesterId === user.id ? link.addressee : link.requester;
      return {
        friendshipId: link.id,
        userId: friend.id,
        username: friend.username,
      };
    });

  const incoming = links
    .filter((link) => link.status === FriendshipStatus.pending && link.addresseeId === user.id)
    .map((link) => ({
      friendshipId: link.id,
      userId: link.requester.id,
      username: link.requester.username,
    }));

  const outgoing = links
    .filter((link) => link.status === FriendshipStatus.pending && link.requesterId === user.id)
    .map((link) => ({
      friendshipId: link.id,
      userId: link.addressee.id,
      username: link.addressee.username,
    }));

  return ok({ friends, incoming, outgoing });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = requestFriendSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid friend request payload.", 400);
  }

  const targetUsername = parsed.data.username.trim();
  const target = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: {
      id: true,
      username: true,
    },
  });

  if (!target) {
    return fail("User not found.", 404);
  }

  if (target.id === user.id) {
    return fail("You cannot add yourself.", 400);
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: user.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: user.id },
      ],
    },
  });

  if (existing?.status === FriendshipStatus.accepted) {
    return ok({ status: "accepted" });
  }

  if (existing && existing.requesterId === target.id && existing.status === FriendshipStatus.pending) {
    await prisma.friendship.update({
      where: { id: existing.id },
      data: { status: FriendshipStatus.accepted },
    });
    return ok({ status: "accepted" });
  }

  if (existing && existing.requesterId === user.id && existing.status === FriendshipStatus.pending) {
    return ok({ status: "pending" });
  }

  await prisma.friendship.create({
    data: {
      requesterId: user.id,
      addresseeId: target.id,
      status: FriendshipStatus.pending,
    },
  });

  return ok({ status: "pending" }, 201);
}
