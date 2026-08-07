/* photo-search-widget.js
 * ------------------------------------------------------------
 * Додає в наявне поле пошуку сайту (той самий інпут з лупою)
 * маленьку іконку фотоапарата — за принципом Google Lens у Google-пошуку.
 * Наведення — підказка. Клік — відкриває пошук за фото.
 *
 * ЯК ПІДКЛЮЧИТИ:
 * Просто встав перед </body>, ПІСЛЯ основного inline-скрипта сторінки
 * (там, де визначається const D):
 *   <script src="photo-search-widget.js"></script>
 * Жодних додаткових <div> у розмітку вставляти не треба — віджет сам
 * знаходить існуюче поле пошуку (#q) і добудовує іконку в нього.
 * ------------------------------------------------------------ */

(function () {
  'use strict';

  const CONFIG = {
    EMBED_ENDPOINT: 'https://print-argo-search.netlify.app/.netlify/functions/embed',
    EMBEDDINGS_URL: 'embeddings.json',
    TOP_N: 12,
    MAX_UPLOAD_SIDE: 1024,
  };

  let embeddingsCache = null;

  function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async function loadEmbeddings() {
    if (embeddingsCache) return embeddingsCache;
    const res = await fetch(CONFIG.EMBEDDINGS_URL);
    if (!res.ok) throw new Error('Не вдалось завантажити базу відбитків каталогу');
    embeddingsCache = await res.json();
    return embeddingsCache;
  }

  function findCatalogItem(id) {
    if (typeof D === 'undefined' || !D.banery) return null;
    return D.banery.find(function (it) { return it.id === id; }) || null;
  }

  function injectStyles() {
    const css = `
      .ps-lens-btn {
        position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        width: 26px; height: 26px; border-radius: 50%; border: none;
        background: transparent; display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: background .15s;
      }
      .ps-lens-btn:hover { background: var(--tint); }
      .ps-lens-btn svg { width: 17px; height: 17px; stroke: var(--gray); }
      .ps-lens-btn:hover svg { stroke: var(--ink); }
      .search input { padding-right: 38px; }
      .qclear { right: 36px !important; }

      .ps-tooltip {
        position: absolute; bottom: calc(100% + 8px); right: 0;
        background: var(--ink); color: #fff; font-size: 12px; font-weight: 500;
        padding: 6px 10px; border-radius: 8px; white-space: nowrap;
        opacity: 0; pointer-events: none; transform: translateY(3px);
        transition: opacity .15s, transform .15s; z-index: 5;
      }
      .ps-tooltip::after {
        content: ''; position: absolute; top: 100%; right: 10px;
        border: 5px solid transparent; border-top-color: var(--ink);
      }
      .ps-lens-btn:hover .ps-tooltip { opacity: 1; transform: translateY(0); }

      .ps-overlay {
        position: fixed; inset: 0; background: rgba(20,20,20,0.5);
        display: flex; align-items: flex-start; justify-content: center;
        z-index: 9999; padding: 6vh 20px; overflow-y: auto;
      }
      .ps-modal {
        background: var(--bg); border-radius: 20px; max-width: 600px; width: 100%;
        padding: 28px; position: relative; font-family: inherit; color: var(--ink);
        box-shadow: 0 20px 60px rgba(0,0,0,.25);
      }
      .ps-close {
        position: absolute; top: 18px; right: 18px; width: 30px; height: 30px;
        border-radius: 50%; border: none; background: var(--tint); cursor: pointer;
        font-size: 15px; line-height: 1; color: var(--ink);
      }
      .ps-close:hover { background: var(--line); }
      .ps-title { font-size: 18px; font-weight: 700; margin: 0 0 6px; padding-right: 30px; }
      .ps-sub { font-size: 13.5px; color: var(--gray); margin: 0 0 22px; line-height: 1.5; }

      .ps-dropzone {
        border: 1.5px dashed var(--line); border-radius: 14px; padding: 36px 16px;
        text-align: center; cursor: pointer; margin-bottom: 4px; transition: border-color .15s, background .15s;
      }
      .ps-dropzone:hover { border-color: var(--accent); background: var(--tint); }

      .ps-crop-wrap { position: relative; margin: 0 auto 16px; max-width: 100%; user-select: none; border-radius: 12px; overflow: hidden; }
      .ps-crop-wrap img { display: block; max-width: 100%; max-height: 48vh; margin: 0 auto; }
      .ps-crop-box {
        position: absolute; border: 2px solid var(--accent);
        box-shadow: 0 0 0 2000px rgba(20,20,20,0.45);
        cursor: move; touch-action: none;
      }
      .ps-handle {
        position: absolute; width: 16px; height: 16px; background: var(--accent);
        border: 2px solid #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.3);
        touch-action: none;
      }
      .ps-handle::before {
        content: ''; position: absolute; top: 50%; left: 50%;
        width: 40px; height: 40px; transform: translate(-50%, -50%);
      }
      .ps-handle.nw { top: -9px; left: -9px; cursor: nwse-resize; }
      .ps-handle.ne { top: -9px; right: -9px; cursor: nesw-resize; }
      .ps-handle.sw { bottom: -9px; left: -9px; cursor: nesw-resize; }
      .ps-handle.se { bottom: -9px; right: -9px; cursor: nwse-resize; }

      .ps-actions { display: flex; gap: 10px; margin-top: 10px; }
      .ps-btn {
        flex: 1; height: 42px; border-radius: 99px; border: 1px solid var(--ink);
        background: var(--ink); color: #fff; font-weight: 700; font-size: 14px;
        cursor: pointer; transition: opacity .15s;
      }
      .ps-btn:hover { opacity: .85; }
      .ps-btn.secondary { background: transparent; color: var(--ink); }
      .ps-btn.secondary:hover { background: var(--tint); opacity: 1; }
      .ps-btn:disabled { opacity: .4; cursor: not-allowed; }

      .ps-status { font-size: 13px; color: var(--gray); margin-top: 12px; text-align: center; }
      .ps-status.err { color: #c0392b; }

      .ps-results { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
      .ps-card { border-radius: 10px; overflow: hidden; border: 1px solid var(--line); text-decoration: none; color: inherit; transition: box-shadow .15s; background: none; padding: 0; text-align: left; display: block; width: 100%; font: inherit; cursor: pointer; }
      .ps-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.12); }
      .ps-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: var(--tint); }
      .ps-card .ps-card-body { padding: 6px 8px; }
      .ps-card .ps-id { font-size: 11px; font-weight: 700; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ps-card .ps-pct { font-size: 10.5px; color: var(--accent); margin: 2px 0 0; font-weight: 600; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderLensIcon() {
    const searchWrap = document.querySelector('.search');
    if (!searchWrap) return;

    const btn = document.createElement('button');
    btn.className = 'ps-lens-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Пошук схожого макета за фото');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '  <path d="M4 8h3l1.6-2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/>' +
      '  <circle cx="12" cy="13.5" r="3.3"/>' +
      '</svg>' +
      '<span class="ps-tooltip">Пошук макета за фото</span>';

    btn.addEventListener('click', openModal);
    searchWrap.appendChild(btn);
  }

  let state = {
    overlay: null,
    naturalW: 0,
    naturalH: 0,
    box: { x: 10, y: 10, w: 80, h: 80 },
    dragMode: null,
    dragStart: null,
  };

  function openModal() {
    const overlay = document.createElement('div');
    overlay.className = 'ps-overlay';
    overlay.innerHTML =
      '<div class="ps-modal">' +
      '  <button class="ps-close" aria-label="Закрити">✕</button>' +
      '  <p class="ps-title">Пошук схожого макета за фото</p>' +
      '  <p class="ps-sub">Завантаж фото-референс. Якщо на фото багато зайвого фону — обріж, лишивши тільки сам дизайн.</p>' +
      '  <div class="ps-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('.ps-close').addEventListener('click', closeModal);
    state.overlay = overlay;
    renderUploadStep();
  }

  function closeModal() {
    if (state.overlay) state.overlay.remove();
    state = { overlay: null, naturalW: 0, naturalH: 0, box: { x: 10, y: 10, w: 80, h: 80 }, dragMode: null, dragStart: null };
  }

  function getBody() {
    return state.overlay.querySelector('.ps-body');
  }

  function renderUploadStep() {
    const body = getBody();
    body.innerHTML =
      '<div class="ps-dropzone">' +
      '  <p style="margin:0 0 6px;font-weight:600;">Натисни, щоб вибрати фото</p>' +
      '  <p style="margin:0;font-size:12.5px;color:var(--gray);">JPG або PNG</p>' +
      '  <input type="file" accept="image/*" style="display:none">' +
      '</div>';
    const dropzone = body.querySelector('.ps-dropzone');
    const input = body.querySelector('input');
    dropzone.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function () { renderCropStep(reader.result); };
    reader.readAsDataURL(file);
  }

  function renderCropStep(dataUrl) {
    const body = getBody();
    body.innerHTML =
      '<div class="ps-crop-wrap">' +
      '  <img src="' + dataUrl + '">' +
      '  <div class="ps-crop-box">' +
      '    <div class="ps-handle nw"></div><div class="ps-handle ne"></div>' +
      '    <div class="ps-handle sw"></div><div class="ps-handle se"></div>' +
      '  </div>' +
      '</div>' +
      '<div class="ps-actions">' +
      '  <button class="ps-btn secondary ps-back">Інше фото</button>' +
      '  <button class="ps-btn ps-search">Шукати схожі</button>' +
      '</div>' +
      '<div class="ps-status"></div>';

    const img = body.querySelector('.ps-crop-wrap img');
    const wrap = body.querySelector('.ps-crop-wrap');
    const cropBox = body.querySelector('.ps-crop-box');

    img.onload = function () {
      state.naturalW = img.naturalWidth;
      state.naturalH = img.naturalHeight;
      state.box = { x: 10, y: 10, w: 80, h: 80 };
      layoutCropBox(wrap, cropBox);
    };
    if (img.complete) img.onload();

    setupCropDragging(wrap, cropBox);

    body.querySelector('.ps-back').addEventListener('click', renderUploadStep);
    body.querySelector('.ps-search').addEventListener('click', function () {
      runSearch(img, wrap);
    });
  }

  function layoutCropBox(wrap, cropBox) {
    const img = wrap.querySelector('img');
    const rect = img.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const offsetX = rect.left - wrapRect.left;
    const offsetY = rect.top - wrapRect.top;

    cropBox.style.left = (offsetX + rect.width * state.box.x / 100) + 'px';
    cropBox.style.top = (offsetY + rect.height * state.box.y / 100) + 'px';
    cropBox.style.width = (rect.width * state.box.w / 100) + 'px';
    cropBox.style.height = (rect.height * state.box.h / 100) + 'px';
  }

  function setupCropDragging(wrap, cropBox) {
    function onPointerDown(mode) {
      return function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.dragMode = mode;
        state.dragStart = { x: e.clientX, y: e.clientY, box: Object.assign({}, state.box) };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
      };
    }

    function onPointerMove(e) {
      if (!state.dragMode) return;
      const img = wrap.querySelector('img');
      const rect = img.getBoundingClientRect();
      const dxPct = (e.clientX - state.dragStart.x) / rect.width * 100;
      const dyPct = (e.clientY - state.dragStart.y) / rect.height * 100;
      const start = state.dragStart.box;
      let b = Object.assign({}, start);

      if (state.dragMode === 'move') {
        b.x = clamp(start.x + dxPct, 0, 100 - start.w);
        b.y = clamp(start.y + dyPct, 0, 100 - start.h);
      } else {
        if (state.dragMode.includes('w')) { b.x = clamp(start.x + dxPct, 0, start.x + start.w - 5); b.w = start.w - (b.x - start.x); }
        if (state.dragMode.includes('e')) { b.w = clamp(start.w + dxPct, 5, 100 - start.x); }
        if (state.dragMode.includes('n')) { b.y = clamp(start.y + dyPct, 0, start.y + start.h - 5); b.h = start.h - (b.y - start.y); }
        if (state.dragMode.includes('s')) { b.h = clamp(start.h + dyPct, 5, 100 - start.y); }
      }
      state.box = b;
      layoutCropBox(wrap, cropBox);
    }

    function onPointerUp() {
      state.dragMode = null;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    }

    cropBox.addEventListener('pointerdown', onPointerDown('move'));
    cropBox.querySelector('.nw').addEventListener('pointerdown', onPointerDown('nw'));
    cropBox.querySelector('.ne').addEventListener('pointerdown', onPointerDown('ne'));
    cropBox.querySelector('.sw').addEventListener('pointerdown', onPointerDown('sw'));
    cropBox.querySelector('.se').addEventListener('pointerdown', onPointerDown('se'));

    window.addEventListener('resize', function () { layoutCropBox(wrap, cropBox); });
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function cropToBase64(img) {
    const sx = state.naturalW * state.box.x / 100;
    const sy = state.naturalH * state.box.y / 100;
    const sw = state.naturalW * state.box.w / 100;
    const sh = state.naturalH * state.box.h / 100;

    const scale = Math.min(1, CONFIG.MAX_UPLOAD_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }

  async function runSearch(img, wrap) {
    const body = getBody();
    const statusEl = body.querySelector('.ps-status');
    const searchBtn = body.querySelector('.ps-search');
    searchBtn.disabled = true;
    statusEl.textContent = 'Рахую відбиток фото...';
    statusEl.className = 'ps-status';

    try {
      const base64 = cropToBase64(img);

      const res = await fetch(CONFIG.EMBED_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Помилка сервера');

      statusEl.textContent = 'Порівнюю з каталогом...';
      const embeddings = await loadEmbeddings();

      const scored = Object.keys(embeddings).map(function (id) {
        return { id: id, score: cosineSimilarity(data.vector, embeddings[id]) };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      const top = scored.slice(0, CONFIG.TOP_N);

      renderResults(top);
    } catch (e) {
      statusEl.textContent = 'Помилка: ' + e.message;
      statusEl.className = 'ps-status err';
      searchBtn.disabled = false;
    }
  }

  function renderResults(top) {
    const body = getBody();
    const grid = document.createElement('div');
    grid.className = 'ps-results';

    top.forEach(function (entry) {
      const item = findCatalogItem(entry.id);
      const imgSrc = item ? item.img : '';
      const title = item ? item.title : '';
      const pct = Math.round(entry.score * 100);

      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'ps-card';
      a.innerHTML =
        '<img src="' + imgSrc + '" alt="' + entry.id + '" loading="lazy">' +
        '<div class="ps-card-body">' +
        '  <p class="ps-id">' + entry.id + (title ? ' — ' + title : '') + '</p>' +
        '  <p class="ps-pct">' + pct + '% схожості</p>' +
        '</div>';
      a.addEventListener('click', function () {
        closeModal(); // закриваємо вікно пошуку, щоб не було "модалка на модалці"
        if (item && typeof openProduct === 'function') {
          openProduct(Object.assign({ kind: 'banner' }, item));
        }
      });
      grid.appendChild(a);
    });

    const status = body.querySelector('.ps-status');
    status.textContent = '';
    body.appendChild(grid);

    const backBtn = document.createElement('button');
    backBtn.className = 'ps-btn secondary';
    backBtn.style.marginTop = '14px';
    backBtn.style.width = '100%';
    backBtn.textContent = 'Спробувати інше фото';
    backBtn.addEventListener('click', renderUploadStep);
    body.appendChild(backBtn);
  }

  function init() {
    injectStyles();
    renderLensIcon();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
