// POST /api/geocode-commande
// Réservé à l'admin. À partir de la position GPS d'une commande,
// interroge Nominatim (OpenStreetMap) pour déterminer la région,
// le département, la commune et le quartier, puis enregistre le
// résultat dans Firestore sous zoneLivraison + zoneCalculeeLe.
//
// Cache : si zoneLivraison existe déjà pour les mêmes coordonnées
// et que force !== true, aucun nouvel appel réseau n'est fait.
//
// Politique Nominatim : une seule requête par invocation, résultat
// mis en cache Firestore, jamais de boucle, User-Agent identifiable.

const { admin, db, auth } = require("./_lib/admin");

// ---------------------------------------------------------------------------
// Helpers génériques
// ---------------------------------------------------------------------------

function jsonError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

// orderId : chaîne, 1..100, sans / ni \
function isValidOrderId(id) {
  return (
    typeof id === "string" &&
    id.length >= 1 &&
    id.length <= 100 &&
    !/[/\\]/.test(id)
  );
}

// Convertit une valeur en nombre fini (ou NaN)
function toNum(x) {
  if (typeof x === "number") return Number.isFinite(x) ? x : NaN;
  if (typeof x === "string" && x.trim() !== "") {
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// Nettoyage de la région : retire les préfixes "Région de", "Region de",
// "Région", "Region" et le suffixe "Region" / "Région".
function cleanRegion(s) {
  if (!s) return "";
  let out = String(s).trim();
  out = out.replace(/^(?:r[ée]gion(?:\s+de)?)\s+/i, "");
  out = out.replace(/\s+r[ée]gion$/i, "");
  return out.trim();
}

// Concatène les parties non vides en dédupliquant (insensible à la casse).
// Séparateur : " — ".
function joinParts(parts) {
  const seen = new Set();
  const out = [];
  for (const raw of parts) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.join(" — ");
}

// ---------------------------------------------------------------------------
// Appel Nominatim (une seule requête, 8s max, User-Agent conforme)
// ---------------------------------------------------------------------------

// Throttle best-effort en mémoire (approximatif : 1 requête/s max par instance
// chaude). Les instances froides et multiples ne partagent pas cette valeur,
// mais le cache Firestore évite déjà 99 % des appels réels.
let _lastNominatimAt = 0;
async function throttleNominatim() {
  const now = Date.now();
  const wait = 1000 - (now - _lastNominatimAt);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  _lastNominatimAt = Date.now();
}

async function fetchNominatim(lat, lng) {
  await throttleNominatim();

  const contact =
    process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.trim() !== ""
      ? process.env.ADMIN_EMAIL.trim()
      : "service.numa.com@gmail.com";

  const url =
    "https://nominatim.openstreetmap.org/reverse" +
    "?format=jsonv2" +
    "&lat=" +
    encodeURIComponent(String(lat)) +
    "&lon=" +
    encodeURIComponent(String(lng)) +
    "&zoom=18" +
    "&addressdetails=1" +
    "&accept-language=fr";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": `NUMA-Senegal-Livraison/1.0 (${contact})`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });

    if (!res.ok) return null;

    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  } catch (_) {
    // AbortError, DNS, timeout réseau, etc.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  // 1. Méthode
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonError(res, 405, "Méthode non autorisée. Utilisez POST.");
  }

  // 2. Corps JSON
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  const orderId = body.orderId;
  if (!isValidOrderId(orderId)) {
    return jsonError(res, 400, "orderId manquant ou invalide");
  }
  const force = body.force === true;

  // 3. Configuration serveur
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    return jsonError(res, 500, "Configuration serveur manquante (ADMIN_UID)");
  }

  // 4. Vérification Firebase Auth
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError(res, 401, "Token d'authentification manquant");
  }
  const idToken = authHeader.substring(7);

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (_) {
    return jsonError(res, 401, "Token invalide ou expiré");
  }

  if (decoded.uid !== adminUid) {
    return jsonError(res, 403, "Réservé à l'administrateur");
  }

  // 5. Lecture de la commande
  const ref = db.collection("commandes").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    return jsonError(res, 404, "Commande introuvable");
  }
  const order = snap.data();

  // 6. Position GPS
  const pos = order.position;
  const lat = pos ? toNum(pos.lat) : NaN;
  const lng = pos ? toNum(pos.lng) : NaN;

  if (!pos || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(200)
      .json({ ok: false, message: "Aucune position GPS sur cette commande" });
  }

  // 7. Bounds Sénégal
  if (lat < 12 || lat > 17 || lng < -18 || lng > -11) {
    return jsonError(res, 422, "Coordonnées hors du Sénégal");
  }

  // 8. Cache : zoneLivraison déjà calculée pour ces mêmes coordonnées
  if (!force && order.zoneLivraison && typeof order.zoneLivraison === "object") {
    const z = order.zoneLivraison;
    const zLat = toNum(z.lat);
    const zLng = toNum(z.lng);
    const sameCoords =
      Number.isFinite(zLat) &&
      Number.isFinite(zLng) &&
      Math.abs(zLat - lat) < 1e-4 &&
      Math.abs(zLng - lng) < 1e-4;

    if (sameCoords) {
      return res.status(200).json({
        ok: true,
        cached: true,
        zone: {
          region: String(z.region || ""),
          departement: String(z.departement || ""),
          commune: String(z.commune || ""),
          quartier: String(z.quartier || ""),
          libelle: String(z.libelle || ""),
          lat: zLat,
          lng: zLng,
          source: "OpenStreetMap",
        },
      });
    }
  }

  // 9. Appel Nominatim
  const data = await fetchNominatim(lat, lng);
  if (!data || !data.address || typeof data.address !== "object") {
    return res
      .status(200)
      .json({ ok: false, message: "Zone introuvable automatiquement" });
  }

  // 10. Transformation de l'adresse
  const addr = data.address;

  const region = cleanRegion(addr.state || addr.region || "");
  const departement = addr.county || addr.state_district || "";
  const commune =
    addr.city ||
    addr.town ||
    addr.municipality ||
    addr.city_district ||
    "";
  const quartier =
    addr.suburb ||
    addr.neighbourhood ||
    addr.quarter ||
    addr.village ||
    addr.hamlet ||
    "";

  const libelle = joinParts([region, departement, commune, quartier]);

  if (!libelle) {
    // Nominatim a répondu mais aucun champ exploitable
    return res
      .status(200)
      .json({ ok: false, message: "Zone introuvable automatiquement" });
  }

  const zone = {
    region: String(region || ""),
    departement: String(departement || ""),
    commune: String(commune || ""),
    quartier: String(quartier || ""),
    libelle,
    lat,
    lng,
    source: "OpenStreetMap",
  };

  // 11. Écriture Firestore (uniquement ces 2 champs)
  try {
    await ref.update({
      zoneLivraison: zone,
      zoneCalculeeLe: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("Écriture zoneLivraison échouée:", e && e.message);
    return jsonError(res, 502, "Impossible d'enregistrer la zone");
  }

  // 12. Réponse
  return res.status(200).json({ ok: true, cached: false, zone });
};
