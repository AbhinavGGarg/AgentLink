import { clearSessionCookie, deleteSessionByToken, getSessionToken } from "@/lib/auth/session";
import { ok } from "@/lib/api/response";

export async function POST() {
  const token = await getSessionToken();
  if (token) {
    await deleteSessionByToken(token);
  }

  const response = ok({ success: true });
  clearSessionCookie(response);
  return response;
}
