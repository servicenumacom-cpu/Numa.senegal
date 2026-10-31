/*
 * NUMA — ajustement automatique des images produits
 *
 * Toutes les cartes gardent exactement le même cadre (3/4).
 * - Image proche du format 3/4 : elle remplit le cadre (léger zoom, "cover").
 * - Image très large, carrée ou très haute : elle s'affiche en entier ("contain"),
 *   sans zoom sur le produit ; les bords sont remplis par une version floue de la même image.
 * Fonctionne aussi pour les cartes créées dynamiquement (Firestore).
 */
(function () {
  'use strict';

  var RATIO = 3 / 4;      // format du cadre des cartes
  var TOLERANCE = 0.25;   // écart max (25 %) pour remplir le cadre en "cover"
  var BOX = '.card .thumb, .thumb-cover, .card-img-wrap';

  // Styles injectés une seule fois (pas besoin de modifier chaque page)
  var style = document.createElement('style');
  style.textContent =
    BOX.split(', ').map(function (s) { return s; }).join(',') + '{position:relative;isolation:isolate}' +
    '.card .thumb::before,.thumb-cover::before,.card-img-wrap::before{' +
      'content:"";position:absolute;inset:0;z-index:-1;' +
      'background:var(--fit-bg) center/cover no-repeat;' +
      'filter:blur(18px);transform:scale(1.25);opacity:0;transition:opacity .3s}' +
    '.card .thumb[data-fit="contain"]::before,' +
    '.thumb-cover[data-fit="contain"]::before,' +
    '.card-img-wrap[data-fit="contain"]::before{opacity:.6}';
  document.head.appendChild(style);

  function fit(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    var box = img.closest(BOX);
    if (!box) return;

    var ratio = img.naturalWidth / img.naturalHeight;
    var cover = Math.abs(ratio - RATIO) / RATIO < TOLERANCE;

    img.style.setProperty('object-fit', cover ? 'cover' : 'contain', 'important');
    img.style.setProperty('object-position', cover ? 'center 25%' : 'center', 'important');

    // Le fond flou est calculé à partir de la première image de la carte
    if (img === box.querySelector('img')) {
      var src = (img.currentSrc || img.src || '').replace(/"/g, '%22');
      if (src) box.style.setProperty('--fit-bg', 'url("' + src + '")');
      box.setAttribute('data-fit', cover ? 'cover' : 'contain');
    }
  }

  function scan(root) {
    var imgs = (root.nodeType === 1 && root.tagName === 'IMG')
      ? [root]
      : (root.querySelectorAll ? root.querySelectorAll('img') : []);
    Array.prototype.forEach.call(imgs, function (img) {
      if (img.complete && img.naturalWidth) fit(img);
    });
  }

  // Images qui finissent de charger (l'événement "load" ne remonte pas : on l'écoute en capture)
  document.addEventListener('load', function (e) {
    if (e.target && e.target.tagName === 'IMG') fit(e.target);
  }, true);

  // Cartes ajoutées plus tard par le JavaScript des pages
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (n.nodeType === 1) scan(n);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(document); });
  } else {
    scan(document);
  }
})();
