import { FriendshipStatus } from "@prisma/client";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const respondSchema = z.object({
  friendshipId: z.string().min(1),
  action: z.enum(["accept", "decline"]),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return fail("Unauthorized.", 401);
  }

  const parsed = respondSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid friend response payload.", 400);
  }

  const requestLink = await prisma.friendship.findUnique({
    where: { id: parsed.data.friendshipId },
  });

  if (!requestLink || requestLink.status !== FriendshipStatus.pending) {
    return fail("Friend request not found.", 404);
  }

  if (requestLink.addresseeId !== user.id) {
    return fail("Only the recipient can respond to this request.", 403);
  }

  if (parsed.data.action === "decline") {
    await prisma.friendship.delete({
      where: { id: requestLink.id },
    });
    return ok({ status: "declined" });
  }

  await prisma.friendship.update({
    where: { id: requestLink.id },
    data: {
      status: FriendshipStatus.accepted,
    },
  });

  return ok({ status: "accepted" });
}
