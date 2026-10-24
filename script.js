// ---------- DONNÉES PRODUITS ----------
// Mets tes images dans le dossier images/ avec ces noms (ou change les chemins ici)
const products = [
  { name: "Robe d'été décontractée", price: 16500, img: "images/produit-1.jpg" },
  { name: "Haut élégant noir",        price: 10200, img: "images/produit-2.jpg" },
  { name: "Haut élégant noir",        price: 10200, img: "images/produit-3.jpg" },
  { name: "Jeans bleu",               price: 25800, img: "images/produit-4.jpg" },
  { name: "Veste en cuir noire",      price: 45000, img: "images/produit-5.jpg" },
  { name: "Escarpins beige",          price: 18500, img: "images/produit-6.jpg" },
  { name: "Mocassins beige",          price: 21000, img: "images/produit-7.jpg" },
  { name: "Bottines noires",          price: 32000, img: "images/produit-8.jpg" },
  // affichés avec "Voir plus"
  { name: "Robe fleurie",             price: 19500, img: "images/produit-9.jpg" },
  { name: "Chemise motifs",           price: 14800, img: "images/produit-10.jpg" },
  { name: "Pantalon beige",           price: 17500, img: "images/produit-11.jpg" },
  { name: "Sac à main",               price: 28000, img: "images/produit-12.jpg" },
];

const PAGE_SIZE = 8;
let shown = 0;

const grid = document.getElementById("grid");
const moreBtn = document.getElementById("moreBtn");
const cartCount = document.getElementById("cartCount");

const formatPrice = (n) => n.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, ".") + " CFA";

function renderMore() {
  const next = products.slice(shown, shown + PAGE_SIZE);
  next.forEach((p) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="thumb"><img src="${p.img}" alt="${p.name}" loading="lazy"></div>
      <div class="price-row">
        <span class="price">${formatPrice(p.price)}</span>
        <button class="fav" aria-label="Ajouter aux favoris">
          <svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>
        </button>
      </div>
      <p class="name">${p.name}</p>
      <button class="add">
        <svg viewBox="0 0 24 24"><path d="M2 3h3l2.5 12h11L21 7H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>
        Ajouter au panier
      </button>`;
    grid.appendChild(card);
  });
  shown += next.length;
  if (shown >= products.length) moreBtn.hidden = true;
}

// ---------- ACTIONS (favoris / panier) ----------
grid.addEventListener("click", (e) => {
  const fav = e.target.closest(".fav");
  if (fav) fav.classList.toggle("on");

  const add = e.target.closest(".add");
  if (add) {
    cartCount.textContent = Number(cartCount.textContent) + 1;
    add.classList.add("added");
    setTimeout(() => add.classList.remove("added"), 600);
  }
});

moreBtn.addEventListener("click", renderMore);
renderMore();

// ---------- CARROUSEL DU BANDEAU ----------
const slides = ["images/hero.jpg", "images/hero-2.jpg"]; // ajoute ta 2e image si tu veux
const heroBg = document.getElementById("heroBg");
const dots = document.querySelectorAll("#dots span");
let current = 0;

function goTo(i) {
  current = i;
  heroBg.style.backgroundImage = `url("${slides[i]}"), linear-gradient(120deg, #e9dcc3, #b9a074)`;
  dots.forEach((d, k) => d.classList.toggle("active", k === i));
}
dots.forEach((d, i) => d.addEventListener("click", () => goTo(i)));
setInterval(() => goTo((current + 1) % slides.length), 5000);






NOUVEAUTER JS
// Produits de la page Nouveautés (cat = catégorie pour les filtres)
// Mets tes images dans images/ ou change les chemins ici
const products = [
  { name: "Robe d'été décontractée", price: 16500, cat: "robes",      img: "images/produit-1.jpg" },
  { name: "Haut élégant noir",        price: 10200, cat: "hauts",      img: "images/produit-2.jpg" },
  { name: "Chemise motifs",           price: 14800, cat: "hauts",      img: "images/produit-3.jpg" },
  { name: "Jeans bleu",               price: 25800, cat: "pantalons",  img: "images/produit-4.jpg" },
  { name: "Veste en cuir noire",      price: 45000, cat: "vestes",     img: "images/produit-5.jpg" },
  { name: "Escarpins beige",          price: 18500, cat: "chaussures", img: "images/produit-6.jpg" },
  { name: "Mocassins beige",          price: 21000, cat: "chaussures", img: "images/produit-7.jpg" },
  { name: "Bottines noires",          price: 32000, cat: "chaussures", img: "images/produit-8.jpg" },
  { name: "Robe fleurie",             price: 19500, cat: "robes",      img: "images/produit-9.jpg" },
  { name: "Blazer moutarde",          price: 38000, cat: "vestes",     img: "images/produit-10.jpg" },
  { name: "Pantalon beige",           price: 17500, cat: "pantalons",  img: "images/produit-11.jpg" },
  { name: "Top bleu canard",          price: 9500,  cat: "hauts",      img: "images/produit-12.jpg" },
];
// L'ordre du tableau = du plus récent au plus ancien

const PAGE_SIZE = 8;
let category = "all";
let sortMode = "new";
let visible = PAGE_SIZE;

const grid = document.getElementById("grid");
const moreBtn = document.getElementById("moreBtn");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const cartCount = document.getElementById("cartCount");

const formatPrice = (n) => n.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, ".") + " CFA";

function getList() {
  let list = products.filter((p) => category === "all" || p.cat === category);
  if (sortMode === "asc") list = [...list].sort((a, b) => a.price - b.price);
  if (sortMode === "desc") list = [...list].sort((a, b) => b.price - a.price);
  return list;
}

function render() {
  const list = getList();
  const slice = list.slice(0, visible);

  grid.innerHTML = slice.map((p) => `
    <article class="card">
      <div class="thumb">
        <span class="tag-new">NOUVEAU</span>
        <img src="${p.img}" alt="${p.name}" loading="lazy">
      </div>
      <div class="price-row">
        <span class="price">${formatPrice(p.price)}</span>
        <button class="fav" aria-label="Ajouter aux favoris">
          <svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>
        </button>
      </div>
      <p class="name">${p.name}</p>
      <button class="add">
        <svg viewBox="0 0 24 24"><path d="M2 3h3l2.5 12h11L21 7H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>
        Ajouter au panier
      </button>
    </article>`).join("");

  count.textContent = `${list.length} article${list.length > 1 ? "s" : ""}`;
  empty.hidden = list.length > 0;
  moreBtn.hidden = visible >= list.length;
}

// Filtres
document.getElementById("filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  category = chip.dataset.cat;
  visible = PAGE_SIZE;
  render();
});

// Tri
document.getElementById("sort").addEventListener("change", (e) => {
  sortMode = e.target.value;
  render();
});

// Voir plus
moreBtn.addEventListener("click", () => {
  visible += PAGE_SIZE;
  render();
});

// Favoris + panier
grid.addEventListener("click", (e) => {
  const fav = e.target.closest(".fav");
  if (fav) fav.classList.toggle("on");

  const add = e.target.closest(".add");
  if (add) {
    cartCount.textContent = Number(cartCount.textContent) + 1;
    add.classList.add("added");
    setTimeout(() => add.classList.remove("added"), 600);
  }
});

render();