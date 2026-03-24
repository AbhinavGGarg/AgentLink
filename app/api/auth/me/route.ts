import { getSessionUser } from "@/lib/auth/session";
import { ok } from "@/lib/api/response";

export async function GET() {
  const user = await getSessionUser();
  return ok({ user });
}
