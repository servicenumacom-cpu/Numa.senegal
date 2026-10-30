const crypto = require("crypto");
const { admin, db, auth } = require("./_lib/admin");
const MAX_LIVRAISON = 30000;
const err = (res, s, m) => res.status(s).json({ ok: false, message: m });

async function handle(req, res) {
  if (req.method !== "POST") return err(res, 405, "Utiliser POST.");
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return err(res, 401, "Connexion requise.");
  let user;
  try { user = await auth.verifyIdToken(h.slice(7)); }
  catch (e) { return err(res, 401, "Session invalide."); }
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  const nom = String(b.nom || "").trim().slice(0, 80);
  const tel = String(b.telephone || "").replace(/\D/g, "");
  const adresse = String(b.adresse || "").trim().slice(0, 200);
  const mode = b.modePaiement === "livraison" ? "livraison" : "wave";
  const items = (Array.isArray(b.articles) ? b.articles : []).slice(0, 30).filter(i => /^[A-Za-z0-9_-]{1,100}$/.test(String(i.produitId)));
  if (!nom || !/^(70|75|76|77|78)\d{7}$/.test(tel) || adresse.length < 3 || !items.length) return err(res, 400, "Informations invalides.");
  const snaps = await db.getAll(...items.map(i => db.collection("produits").doc(i.produitId)));
  const articles = []; let total = 0;
  for (let i = 0; i < items.length; i++) {
    const p = snaps[i], q = Math.max(1, Math.min(10, Number(items[i].quantite) || 1));
    if (!p.exists) return err(res, 400, "Article indisponible.");
    const d = p.data(), st = d.stock || {}, taille = String(items[i].taille || "Taille unique");
    const k = Object.keys(st).find(x => x.trim().toUpperCase() === taille.toUpperCase());
    if (Object.keys(st).length && (k === undefined || (Number(st[k]) || 0) < q)) return err(res, 409, `Stock insuffisant : ${d.titre}`);
    const prix = Number(d.prix) || 0; total += prix * q;
    articles.push({ produitId: items[i].produitId, titre: String(d.titre || "Article"), prix, prixCatalogue: prix, quantite: q, taille, imageUrl: String(d.imageUrl || "") });
  }
  if (mode === "livraison" && total > MAX_LIVRAISON) return err(res, 400, "Paiement à la livraison limité à 30.000 CFA.");
  const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "inconnue").split(",")[0].trim().replace(/[^A-Za-z0-9]/g, "_").slice(0, 60);
  const lref = db.collection("limites").doc(ip);
  const ok = await db.runTransaction(async tx => {
    const s = await tx.get(lref), now = Date.now();
    const recent = ((s.exists && s.data().essais) || []).filter(t => now - t < 600000);
    if (recent.length >= 5) return false;
    tx.set(lref, { essais: [...recent, now] }); return true;
  });
  if (!ok) return err(res, 429, "Trop de commandes, réessayez dans quelques minutes.");
  const bl = await db.collection("listeNoire").doc(tel).get();
  if (bl.exists && bl.data().bloque === true) return err(res, 403, "Commande impossible avec ce numéro.");
  const p = b.position, pos = p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) ? { lat: Number(p.lat), lng: Number(p.lng), mapsUrl: `https://www.google.com/maps?q=${Number(p.lat)},${Number(p.lng)}`, source: String(p.source || "inconnue").slice(0, 40) } : null;
  const numero = `NUMA-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const ref = await db.collection("commandes").add({ uid: user.uid, clientNom: nom, clientEmail: user.email || "", telephone: tel, articles, total, fraisLivraison: 0, position: pos, adresseTexte: adresse, statut: "en_attente", paiement: "non_paye", modePaiement: mode, numero, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return res.status(200).json({ ok: true, orderId: ref.id, numero, total });
}

module.exports = async function handler(req, res) {
  try { return await handle(req, res); }
  catch (e) {
    console.error("creer-commande:", e && e.message);
    if (!res.headersSent) return err(res, 500, "Erreur serveur, réessayez dans un instant.");
  }
};
