import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession, attachSessionCookie } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_\-.]+$/),
  password: z.string().min(6).max(120),
});

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid registration payload.", 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const username = parsed.data.username.trim();

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existing) {
    return fail("Email or username already in use.", 409);
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });

  const { token, expiresAt } = await createSession(user.id);
  const response = ok({ user }, 201);
  attachSessionCookie(response, token, expiresAt);
  return response;
}
