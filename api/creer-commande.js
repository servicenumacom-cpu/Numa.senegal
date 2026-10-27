const { admin, db, auth } = require("./_lib/admin");
const MAX_LIVRAISON = 30000;
const err = (res, s, m) => res.status(s).json({ ok: false, message: m });

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return err(res, 405, "Utiliser POST.");
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return err(res, 401, "Connexion requise.");
  let user;
  try { user = await auth.verifyIdToken(h.slice(7)); }
  catch (e) { return err(res, 401, "Session invalide."); }
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  // SUITE : étape 2
};
