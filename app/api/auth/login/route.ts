import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession, attachSessionCookie } from "@/lib/auth/session";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

const loginSchema = z.object({
  identity: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return fail("Invalid login payload.", 400);
  }

  const identity = parsed.data.identity.trim();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identity.toLowerCase() }, { username: identity }],
    },
  });

  if (!user) {
    return fail("Invalid credentials.", 401);
  }

  const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    return fail("Invalid credentials.", 401);
  }

  const { token, expiresAt } = await createSession(user.id);
  const response = ok({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
    },
  });

  attachSessionCookie(response, token, expiresAt);
  return response;
}
