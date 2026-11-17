import { cert, getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Credenciais somente no servidor:
 *  - FIREBASE_SERVICE_ACCOUNT_JSON (JSON da service account), ou
 *  - GOOGLE_APPLICATION_CREDENTIALS / credenciais padrão do ambiente.
 * Nunca usar prefixo NEXT_PUBLIC_.
 */
function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === "z1-admin");
  if (existing) return existing;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  return initializeApp(
    {
      credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
      projectId,
    },
    "z1-admin",
  );
}

export function adminFirestore() {
  const db = getFirestore(getAdminApp());
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() só pode ser chamado uma vez por instância.
  }
  return db;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}
