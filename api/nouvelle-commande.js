// POST /api/nouvelle-commande
// Envoie un e-mail à l'admin lorsqu'une nouvelle commande est passée.
// Sécurité : vérifie le token Firebase du client, vérifie que la commande
// lui appartient, qu'elle est récente (<10 min) et pas encore alertée.

const { admin, db, auth } = require("./_lib/admin");

// ---- Helpers ----

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function jsonError(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

// Convertit createdAt (Timestamp Firestore, ms, Date ou string ISO) en ms
function getCreatedAtMs(order) {
  const c = order.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === "function") return c.toMillis();
  if (typeof c.toDate === "function") return c.toDate().getTime();
  if (typeof c === "number") return c;
  if (c.seconds !== undefined) return c.seconds * 1000;
  const d = new Date(c);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatCfa(n) {
  return Number(n || 0).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, ".") + " CFA";
}

// Construit l'e-mail HTML avec échappement strict
function buildEmailHtml(order, orderId, siteUrl) {
  const numero = escapeHtml(order.numero || orderId);
  const clientNom = escapeHtml(order.clientNom || "—");
  const telephone = escapeHtml(order.telephone || "—");
  const total = formatCfa(order.total);
  const adresse = escapeHtml(order.adresseTexte || "—");
  const mapsUrl = order.position?.mapsUrl || "";
  const modePaiement = order.modePaiement === "livraison"
    ? "Paiement à la livraison (espèces)"
    : "Wave";

  const articles = Array.isArray(order.articles) ? order.articles : [];
  const articlesHtml = articles.length
    ? articles
        .map(
          (a) => `<li>
            <strong>${escapeHtml(a.titre || "Article")}</strong>
            — Taille ${escapeHtml(a.taille || "—")}
            — Qté ${escapeHtml(a.quantite || 1)}
            — ${formatCfa(a.prix)}
          </li>`
        )
        .join("")
    : "<li>Aucun article</li>";

  const mapsLink = mapsUrl
    ? `<p><a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">📍 Voir sur Google Maps</a></p>`
    : "";

  const adminLink = siteUrl
    ? `<p style="margin-top:20px"><a href="${escapeHtml(siteUrl)}/admin.html" style="background:#0a0a0a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700">Ouvrir l'admin</a></p>`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;color:#111;max-width:600px">
      <h2 style="margin:0 0 12px">Nouvelle commande NUMA</h2>
      <p><strong>Numéro :</strong> ${numero}</p>
      <p><strong>Client :</strong> ${clientNom}</p>
      <p><strong>Téléphone :</strong> ${telephone}</p>
      <p><strong>Paiement :</strong> ${modePaiement}</p>
      <p><strong>Total :</strong> ${total}</p>
      <h3 style="margin-top:24px">Articles</h3>
      <ul>${articlesHtml}</ul>
      <p><strong>Adresse :</strong> ${adresse}</p>
      ${mapsLink}
      ${adminLink}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#888;font-size:12px">Notification automatique NUMA</p>
    </div>
  `.trim();
}

// ---- Handler ----

module.exports = async function handler(req, res) {
  // 1. Méthode
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonError(res, 405, "Méthode non autorisée. Utilisez POST.");
  }

  // 2. Parse du corps
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  // 3. Validation orderId
  const orderId = body.orderId;
  if (
    typeof orderId !== "string" ||
    orderId.length === 0 ||
    orderId.length > 100 ||
    /[\/\\]/.test(orderId)
  ) {
    return jsonError(res, 400, "orderId manquant ou invalide");
  }

  // 4. Vérification du token Firebase
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

  // 5. Claim atomique + validation (transaction)
  let orderData;
  try {
    orderData = await db.runTransaction(async (tx) => {
      const ref = db.collection("commandes").doc(orderId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw Object.assign(new Error("Commande introuvable"), { code: "not_found" });
      }
      const order = snap.data();

      if (order.uid !== decoded.uid) {
        throw Object.assign(new Error("Cette commande ne vous appartient pas"), {
          code: "forbidden",
        });
      }
      if (order.statut !== "en_attente") {
        throw Object.assign(new Error("La commande n'est pas en attente"), {
          code: "bad_status",
        });
      }
      if (order.paiement !== "non_paye") {
        throw Object.assign(new Error("La commande n'est pas en attente de paiement"), {
          code: "bad_payment",
        });
      }

      const createdAtMs = getCreatedAtMs(order);
      if (!createdAtMs || Date.now() - createdAtMs > 10 * 60 * 1000) {
        throw Object.assign(new Error("Commande expirée (plus de 10 minutes)"), {
          code: "expired",
        });
      }

      if (order.alerteEmailEnvoyeeLe) {
        throw Object.assign(new Error("Alerte déjà envoyée"), { code: "already" });
      }

      // Claim : on pose le champ dans la même transaction
      tx.update(ref, {
        alerteEmailEnvoyeeLe: admin.firestore.FieldValue.serverTimestamp(),
      });

      return order;
    });
  } catch (e) {
    const code = e.code || "error";
    if (code === "not_found") return jsonError(res, 404, e.message);
    if (code === "forbidden") return jsonError(res, 403, e.message);
    if (code === "bad_status" || code === "bad_payment" || code === "already") {
      return jsonError(res, 409, e.message);
    }
    if (code === "expired") return jsonError(res, 410, e.message);
    console.error("Erreur transaction:", e.message);
    return jsonError(res, 500, "Erreur interne");
  }

  // 6. Envoi de l'e-mail via Resend
  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const emailHtml = buildEmailHtml(orderData, orderId, siteUrl);
  const modeLabel = orderData.modePaiement === "livraison" ? "À LA LIVRAISON" : "WAVE";
  const subject = `Nouvelle commande ${modeLabel} — ${orderData.numero || orderId}`;
  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "NUMA <onboarding@resend.dev>",
        to: process.env.ADMIN_EMAIL,
        subject,
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      const txt = await resendRes.text().catch(() => "");
      throw new Error(`Resend HTTP ${resendRes.status} : ${txt.slice(0, 200)}`);
    }
  } catch (e) {
    console.error("Echec envoi email:", e.message);

    // On retire le claim pour permettre un nouvel essai
    try {
      await db.collection("commandes").doc(orderId).update({
        alerteEmailEnvoyeeLe: admin.firestore.FieldValue.delete(),
      });
    } catch (cleanupErr) {
      console.error("Echec cleanup claim:", cleanupErr.message);
    }

    return jsonError(res, 502, "Erreur lors de l'envoi de l'e-mail à l'admin");
  }

  // 7. Succès
  return res.status(200).json({ ok: true });
};
