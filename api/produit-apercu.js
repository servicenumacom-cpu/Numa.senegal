// GET /partage/:id  (réécrit vers /api/produit-apercu?id=:id dans vercel.json)
//
// Lien de partage d'un produit.
// - WhatsApp, Facebook, Telegram, X... (qui ne lancent pas le JavaScript) reçoivent une page
//   avec le nom, le prix et la photo du produit : c'est ce qui fait l'aperçu du lien.
// - Un vrai navigateur est redirigé tout de suite vers la fiche produit normale.
//
// Aucune clé secrète : la collection "produits" est en lecture publique dans les règles Firestore.

const SITE = "https://numasenegal.com";
const FIRESTORE_PRODUITS =
  "https://firestore.googleapis.com/v1/projects/numa-com/databases/(default)/documents/produits";
const BANNER = SITE + "/og-banner.jpg?v=1";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 12500 -> "12.500 CFA" (même format que le site)
const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " CFA";

// Vrai navigateur ? (les robots d'aperçu n'ont pas "Mozilla/5.0" ou contiennent un nom de robot)
function isHumanBrowser(ua) {
  ua = String(ua || "");
  if (!/Mozilla\/5\.0/.test(ua)) return false;
  return !/bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|twitter|linkedin|slack|discord|pinterest|skype|preview|embed|curl|wget|vkshare|headless/i.test(
    ua
  );
}

// Image de l'aperçu : JPG 1200x630, produit centré sur fond blanc (rien n'est coupé)
function ogImageFor(url) {
  url = String(url || "");
  if (!/^https:\/\//.test(url)) return { url: BANNER, wide: true };
  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)) return { url, wide: false };
  if (/\/upload\/[^/]*(f_|q_|w_|c_)/.test(url)) return { url, wide: false }; // déjà transformée
  return {
    url: url.replace("/image/upload/", "/image/upload/f_jpg,q_auto,w_1200,h_630,c_pad,b_white/"),
    wide: true,
  };
}

const gv = (field) => {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue, 10);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  return null;
};

async function loadProduct(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`${FIRESTORE_PRODUITS}/${encodeURIComponent(id)}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const f = (await r.json()).fields || {};
    if (gv(f.actif) === false) return null; // produit masqué : pas d'aperçu
    const nom = gv(f.titre);
    if (!nom) return null;
    return { nom: String(nom), prix: gv(f.prix) || 0, image: gv(f.imageUrl) };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function page({ title, description, shareUrl, image, goPath, product }) {
  const tags = [
    `<meta property="og:type" content="${product ? "product" : "website"}">`,
    `<meta property="og:site_name" content="NUMA Sénégal">`,
    `<meta property="og:locale" content="fr_SN">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(shareUrl)}">`,
    `<meta property="og:image" content="${esc(image.url)}">`,
    `<meta property="og:image:secure_url" content="${esc(image.url)}">`,
    image.wide ? `<meta property="og:image:width" content="1200">` : "",
    image.wide ? `<meta property="og:image:height" content="630">` : "",
    `<meta property="og:image:alt" content="${esc(title)}">`,
    product ? `<meta property="product:price:amount" content="${esc(Math.round(Number(product.prix) || 0))}">` : "",
    product ? `<meta property="product:price:currency" content="XOF">` : "",
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image.url)}">`,
  ]
    .filter(Boolean)
    .join("\n  ");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex">
  ${tags}
</head>
<body style="font-family:Arial,sans-serif;text-align:center;padding:48px 16px;color:#0a0a0a">
  <h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>
  <p style="margin:0 0 24px;color:#555">${esc(description)}</p>
  <a href="${esc(goPath)}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;font-weight:700;text-decoration:none">Voir sur NUMA Sénégal</a>
  <script>location.replace(${JSON.stringify(goPath).replace(/</g, "\\u003c")});</script>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end();
  }

  const id = String((req.query && req.query.id) || "");
  const idOk = ID_RE.test(id);
  const goPath = idOk ? `/produit.html?id=${encodeURIComponent(id)}` : "/";

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  // Vrai navigateur : direction la fiche produit
  if (isHumanBrowser(req.headers["user-agent"])) {
    res.statusCode = 302;
    res.setHeader("Location", goPath);
    return res.end();
  }

  // Robot d'aperçu (ou client inconnu) : page avec les infos du produit
  const product = idOk ? await loadProduct(id) : null;
  const shareUrl = idOk ? `${SITE}/partage/${encodeURIComponent(id)}` : SITE + "/";

  const html = product
    ? page({
        title: `${product.nom} — ${fmt(product.prix)}`,
        description: "Livraison gratuite partout au Sénégal. Paiement à la livraison ou par Wave. NUMA Sénégal.",
        shareUrl,
        image: ogImageFor(product.image),
        goPath,
        product,
      })
    : page({
        title: "NUMA Sénégal — Vêtements en ligne au Sénégal",
        description:
          "Vêtements homme et femme. Livraison 100% gratuite partout au Sénégal. Paiement à la livraison ou par Wave.",
        shareUrl,
        image: { url: BANNER, wide: true },
        goPath,
        product: null,
      });

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(req.method === "HEAD" ? undefined : html);
};

// Exposé pour les tests
module.exports._test = { isHumanBrowser, ogImageFor, fmt, esc };
