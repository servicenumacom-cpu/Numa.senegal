// POST /api/sms-confirmation
// Envoie un SMS au client quand l'admin confirme le paiement.
// Réservé à l'admin (ADMIN_UID).

const { admin, db, auth } = require("./_lib/admin");

// Cache en mémoire du token Orange (réutilisé entre invocations chaudes)
let orangeTokenCache = { token: null, expiresAt: 0 };

// ---- Helpers ----

function jsonError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

function getCreatedAtMs(order) {
  const c = order.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === "function") return c.toMillis();
  if (typeof c.toDate === "function") return c.toDate().getTime();
  if (typeof c === "number") return c;
  if (c.seconds !== undefined) return c.seconds * 1000;
  return 0;
}

// Normalise un numéro sénégalais : accepte "785702916", "0785702916",
// "+221785702916", "221785702916", "tel:+221785702916", etc.
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("221")) local = local.substring(3);
  if (local.startsWith("0")) local = local.substring(1);
  if (!/^(70|75|76|77|78)\d{7}$/.test(local)) return null;
  return "+221" + local;
}

// Format jj/mm (Dakar = UTC+0, pas de DST → on peut utiliser UTC)
function fmtDDMM(date) {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return d + "/" + m;
}

// Supprime les accents pour respecter la norme GSM
function stripAccents(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Construit le message (≤ 160 caractères, sans accents ni emoji)
function buildMessage(order, orderId) {
  const numero = order.numero || orderId;
  const now = Date.now();
  const d1 = fmtDDMM(new Date(now + 24 * 3600 * 1000));
  const d2 = fmtDDMM(new Date(now + 48 * 3600 * 1000));
  let msg = `NUMA: commande ${numero} confirmee. Livraison prevue entre le ${d1} et le ${d2}. Merci!`;
  msg = stripAccents(msg).replace(/[^\x20-\x7E]/g, ""); // ASCII imprimable
  if (msg.length > 160) msg = msg.substring(0, 157) + "...";
  return msg;
}

// ---- Orange OAuth ----

async function getOrangeToken() {
  const now = Date.now();
  if (
    orangeTokenCache.token &&
    orangeTokenCache.expiresAt > now + 60 * 1000
  ) {
    return orangeTokenCache.token;
  }

  const res = await fetch("https://api.orange.com/oauth/v3/token", {
    method: "POST",
    headers: {
      Authorization: process.env.ORANGE_AUTH_HEADER,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Orange OAuth HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Orange OAuth: access_token absent");
  }

  orangeTokenCache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return orangeTokenCache.token;
}

// Envoi brut d'un SMS (une seule tentative)
async function sendSmsOnce(address, message) {
  const sender = (process.env.ORANGE_SENDER || "2210000").replace(/^\+/, "");
  const token = await getOrangeToken();

  const payload = {
    outboundSMSMessageRequest: {
      address: address,
      senderAddress: "tel:+" + sender,
      outboundSMSTextMessage: { message },
    },
  };
  if (process.env.ORANGE_SENDER_NAME) {
    payload.outboundSMSMessageRequest.senderName = process.env.ORANGE_SENDER_NAME;
  }

  return fetch(
    `https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B${sender}/requests`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
}

// Envoi avec un seul retry si 401 (jeton expiré côté Orange)
async function sendSms(address, message) {
  let res = await sendSmsOnce(address, message);
  if (res.status === 401) {
    const bodyText = await res.text().catch(() => "");
    // Code 42 = jeton expiré. On retente une fois après invalidation du cache.
    if (/\b42\b/.test(bodyText) || /expired/i.test(bodyText)) {
      orangeTokenCache = { token: null, expiresAt: 0 };
      res = await sendSmsOnce(address, message);
    }
  }
  return res;
}

// ---- Handler ----

module.exports = async function handler(req, res) {
  // 1. Méthode
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonError(res, 405, "Méthode non autorisée. Utilisez POST.");
  }

  // 2. Config serveur
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    return jsonError(res, 500, "Configuration serveur manquante (ADMIN_UID)");
  }

  // 3. Parse du corps
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  // 4. Validation orderId
  const orderId = body.orderId;
  if (
    typeof orderId !== "string" ||
    orderId.length === 0 ||
    orderId.length > 100 ||
    /[\/\\]/.test(orderId)
  ) {
    return jsonError(res, 400, "orderId manquant ou invalide");
  }

  // 5. Vérification token + rôle admin
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError(res, 401, "Token d'authentification manquant");
  }
  const idToken = authHeader.substring(7);

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (e) {
    return jsonError(res, 401, "Token invalide ou expiré");
  }

  if (decoded.uid !== adminUid) {
    return jsonError(res, 403, "Réservé à l'administrateur");
  }

  // 6. Lecture de la commande
  const ref = db.collection("commandes").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) {
    return jsonError(res, 404, "Commande introuvable");
  }
  const order = snap.data();

  if (order.paiement !== "paye") {
    return jsonError(res, 409, "La commande n'est pas marquée comme payée");
  }
  if (order.statut === "annulee") {
    return jsonError(res, 409, "La commande est annulée");
  }

  // 7. Idempotence : déjà envoyé ?
  if (order.smsConfirmationEnvoyeLe) {
    return res.status(200).json({ ok: true, alreadySent: true });
  }

  // 8. Normalisation du téléphone
  const address = normalizePhone(order.telephone);
  if (!address) {
    return jsonError(
      res,
      422,
      "Numéro de téléphone client invalide (attendu : 70/75/76/77/78 + 7 chiffres)"
    );
  }

  // 9. Construction du message
  const message = buildMessage(order, orderId);

  // 10. Envoi via Orange
  let smsRes;
  try {
    smsRes = await sendSms(address, message);
  } catch (e) {
    console.error("Echec appel Orange:", e.message);
    return res.status(502).json({
      ok: false,
      message: "Echec réseau lors de l'envoi du SMS Orange",
    });
  }

  if (!smsRes.ok) {
    const errText = await smsRes.text().catch(() => "");
    console.error("Echec Orange SMS:", smsRes.status, errText.slice(0, 200));
    return res.status(502).json({
      ok: false,
      message: `Orange SMS HTTP ${smsRes.status}`,
    });
  }

  // 11. Récupérer le resourceId (best effort)
  let smsResourceId = null;
  try {
    const json = await smsRes.json();
    smsResourceId =
      json?.outboundSMSMessageRequest?.resourceId ||
      json?.resourceId ||
      null;
  } catch (_) {
    // pas bloquant
  }

  // 12. Enregistrement en base (uniquement en cas de succès)
  try {
    await ref.update({
      smsConfirmationEnvoyeLe: admin.firestore.FieldValue.serverTimestamp(),
      smsResourceId: smsResourceId,
    });
  } catch (e) {
    console.error("SMS envoyé mais enregistrement Firestore échoué:", e.message);
    // Le SMS est parti : on prévient quand même l'admin, mais on signale
    return res.status(200).json({
      ok: true,
      warning: "SMS envoyé mais marquage Firestore échoué",
    });
  }

  return res.status(200).json({ ok: true });
};
