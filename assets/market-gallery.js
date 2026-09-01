(() => {
  if (window.__vestalandMarketGallery) return;
  window.__vestalandMarketGallery = true;

  const state = { store: '', id: 0, data: null, loading: null, selectedVariation: null, activeSrc: '' };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function uniqueImages(product, variations = []) {
    const out = [];
    const seen = new Set();
    const add = (img, source = 'product', variationId = null) => {
      const src = img?.src || img?.image || '';
      if (!src || seen.has(src)) return;
      seen.add(src);
      out.push({ src, alt: img?.alt || product?.name || '', source, variationId });
    };
    (product?.images || []).forEach(img => add(img, 'product'));
    variations.forEach(v => (v.images || []).forEach(img => add(img, 'variation', v.id)));
    if (!out.length && product?.image) add({src: product.image, alt: product.name}, 'product');
    return out.slice(0, 12);
  }

  async function fetchDetail() {
    if (!state.store || !state.id) return null;
    if (state.loading) return state.loading;
    state.loading = (async () => {
      const pRes = await fetch(`/api/market/product?store=${encodeURIComponent(state.store)}&id=${encodeURIComponent(state.id)}`, {cache:'no-store'});
      const pd = await pRes.json().catch(() => ({}));
      if (!pRes.ok) throw new Error(pd.error || 'جزئیات محصول دریافت نشد.');
      const product = pd.product || {};
      let variations = [];
      if (product.has_options) {
        const vRes = await fetch(`/api/market/products?store=${encodeURIComponent(state.store)}&type=variation&parent=${encodeURIComponent(state.id)}&per_page=100`, {cache:'no-store'});
        const vd = await vRes.json().catch(() => ({}));
        if (vRes.ok) variations = vd.items || [];
      }
      state.data = { product, variations, images: uniqueImages(product, variations) };
      return state.data;
    })().finally(() => { state.loading = null; });
    return state.loading;
  }

  function preferredImage(data) {
    if (!data?.images?.length) return null;
    if (state.selectedVariation) {
      const exact = data.images.find(x => Number(x.variationId) === Number(state.selectedVariation));
      if (exact) return exact;
    }
    if (state.activeSrc) {
      const active = data.images.find(x => x.src === state.activeSrc);
      if (active) return active;
    }
    return data.images[0];
  }

  function injectGallery() {
    const detail = document.querySelector('.market-detail');
    if (!detail || !state.data?.images?.length) return;
    const old = detail.querySelector('.market-detail-gallery');
    if (!old) return;

    const data = state.data;
    const active = preferredImage(data);
    if (!active) return;
    state.activeSrc = active.src;

    old.innerHTML = `
      <div class="market-gallery-main">
        <img src="${esc(active.src)}" alt="${esc(active.alt || data.product?.name || '')}" loading="eager" referrerpolicy="no-referrer">
        ${data.images.length > 1 ? `<span class="market-gallery-count">۱ از ${new Intl.NumberFormat('fa-IR').format(data.images.length)}</span>` : ''}
      </div>
      ${data.images.length > 1 ? `<div class="market-gallery-thumbs" aria-label="گالری محصول">${data.images.map((x, i) => `<button type="button" class="market-gallery-thumb ${x.src === active.src ? 'active' : ''}" data-gallery-src="${esc(x.src)}" data-gallery-index="${i}" aria-label="تصویر ${i + 1}"><img src="${esc(x.src)}" alt="${esc(x.alt || data.product?.name || '')}" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}`;
    old.dataset.galleryEnhanced = '1';
  }

  function updateMain(src, button) {
    const main = document.querySelector('.market-gallery-main img');
    if (!main || !src) return;
    state.activeSrc = src;
    main.src = src;
    document.querySelectorAll('.market-gallery-thumb').forEach(x => x.classList.toggle('active', x === button));
    const count = document.querySelector('.market-gallery-count');
    if (count && button?.dataset.galleryIndex != null) {
      const n = Number(button.dataset.galleryIndex) + 1;
      count.textContent = `${new Intl.NumberFormat('fa-IR').format(n)} از ${new Intl.NumberFormat('fa-IR').format(state.data?.images?.length || 1)}`;
    }
  }

  async function prepare(store, id) {
    const changed = state.store !== store || Number(state.id) !== Number(id);
    state.store = store;
    state.id = Number(id);
    if (changed) {
      state.data = null;
      state.selectedVariation = null;
      state.activeSrc = '';
    }
    try {
      await fetchDetail();
      requestAnimationFrame(injectGallery);
    } catch (_) {}
  }

  document.addEventListener('click', e => {
    const open = e.target.closest('[data-mdetail]');
    if (open) {
      const [store, id] = String(open.dataset.mdetail || '').split('|');
      if (store && id) prepare(store, Number(id));
    }

    const variant = e.target.closest('[data-mvariation]');
    if (variant) {
      state.selectedVariation = Number(variant.dataset.mvariation);
      state.activeSrc = '';
      setTimeout(injectGallery, 30);
    }

    const thumb = e.target.closest('[data-gallery-src]');
    if (thumb) {
      e.preventDefault();
      e.stopPropagation();
      updateMain(thumb.dataset.gallerySrc, thumb);
    }
  }, true);

  const observer = new MutationObserver(() => {
    const gallery = document.querySelector('.market-detail-gallery');
    if (!gallery || gallery.dataset.galleryEnhanced === '1') return;
    if (state.data) injectGallery();
  });

  const start = () => observer.observe(document.body, {subtree:true, childList:true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();