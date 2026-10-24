// Initialisation unique de firebase-admin pour toutes les fonctions serverless.
// Le préfixe "_" dans le nom du dossier évite que Vercel n'expose ce fichier
// comme une route publique.

const admin = require("firebase-admin");

// Initialisation idempotente (Vercel réutilise le process entre invocations)
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT manquant dans les variables d'environnement");
  }

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT n'est pas un JSON valide");
  }

  admin.initializeApp({
    credential: admin.credential.cert(creds),
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
