import { adminAuth } from "./firebase-admin";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Exige um ID token Firebase válido cujo UID/e-mail esteja nas allow-lists privadas. */
export async function requireAdmin(request: Request): Promise<{ uid: string; email: string | null }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AuthError("Login necessário.", 401);

  const uids = list(process.env.ADMIN_UIDS);
  const emails = list(process.env.ADMIN_EMAILS);
  if (uids.length === 0 && emails.length === 0) {
    throw new AuthError("Nenhum administrador configurado (ADMIN_UIDS / ADMIN_EMAILS).", 403);
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch {
    throw new AuthError("Token inválido ou expirado.", 401);
  }

  const email = decoded.email?.toLowerCase() ?? null;
  const allowed =
    uids.includes(decoded.uid.toLowerCase()) || (email !== null && decoded.email_verified === true && emails.includes(email));
  if (!allowed) throw new AuthError("Acesso restrito a administradores.", 403);

  return { uid: decoded.uid, email };
}
