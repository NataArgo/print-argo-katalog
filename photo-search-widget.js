/* photo-search-widget.js
 * ------------------------------------------------------------
 * Що робить цей файл:
 * Додає на сторінку кнопку "Знайти схожий макет за фото".
 * Користувач завантажує фото, обрізає зайве, і бачить найсхожіші
 * банери з каталогу.
 *
 * ЯК ПІДКЛЮЧИТИ (2 кроки):
 * 1. У тому місці HTML, де має бути кнопка входу в пошук
 *    (наприклад, над сіткою банерів), встав:
 *      <div id="photo-search-entry"></div>
 *
 *    Якщо хочеш ще й пункт у меню "Інструменти" — встав такий самий
 *    div ще раз там, з ІНШИМ id, наприклад:
 *      <div id="photo-search-entry-menu"></div>
 *    і нижче в налаштуваннях (розділ CONFIG) додай його в ENTRY_SELECTORS.
 *
 * 2. Перед закриваючим </body> встав:
 *      <script src="photo-search-widget.js"></script>
 *    ОБОВ'ЯЗКОВО після того місця, де на сторінці визначається `const D`
 *    (це там, де вся база каталогу) — віджет використовує її напряму,
 *    щоб не завантажувати каталог ще раз.
 * ------------------------------------------------------------ */

(function () {
  'use strict';

  // ============== НАЛАШТУВАННЯ ==============
  const CONFIG = {
    // Куди йде фото для розрахунку "відбитку" (наша Netlify Function).
    EMBED_ENDPOINT: 'https://print-argo-search.netlify.app/.netlify/functions/embed',
    // Де лежить файл з готовими відбитками каталогу (той самий репозиторій).
    EMBEDDINGS_URL: 'embeddings.json',
    // Скільки схожих банерів показувати.
    TOP_N: 12,
    // У які елементи на сторінці вставити кнопку входу.
    ENTRY_SELECTORS: ['#photo-search-entry', '#photo-search-entry-menu'],
    // Максимальний розмір фото, яке відправляємо (довша сторона, px) —
    // менше фото = швидше і дешевше, якість пошуку від цього не страждає.
    MAX_UPLOAD_SIDE: 1024,
  };

  let embeddingsCache = null; // { id: [768 чисел], ... }

  // ============== ДОПОМІЖНІ ФУНКЦІЇ ==============

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

  // Знаходить дані банера (шлях до фото, назву) у вже наявній на сторінці
  // базі каталогу `D`, яка визначена в основному скрипті сторінки.
  function findCatalogItem(id) {
    if (typeof D === 'undefined' || !D.banery) return null;
    return D.banery.find(function (it) { return it.id === id; }) || null;
  }

  // ============== СТИЛІ ==============

  function injectStyles() {
    const css = `
      .ps-entry-btn {
        display: flex; align-items: center; gap: 12px;
        background: #f4f7ee; border: 1.5px solid #5E9A1E; border-radius: 14px;
        padding: 16px 20px; cursor: pointer; width: 100%; max-width: 480px;
        font-family: inherit; text-align: left; margin: 16px 0;
      }
      .ps-entry-btn:hover { background: #EAF3DE; }
      .ps-entry-icon { font-size: 26px; line-height: 1; }
      .ps-entry-text b { display: block; font-size: 15px; color: #1a1a1a; }
      .ps-entry-text span { font-size: 13px; color: #6b6b68; }

      .ps-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; padding: 20px;
      }
      .ps-modal {
        background: #fff; border-radius: 16px; max-width: 640px; width: 100%;
        max-height: 88vh; overflow-y: auto; padding: 24px; position: relative;
        font-family: inherit; color: #1a1a1a;
      }
      .ps-close {
        position: absolute; top: 16px; right: 16px; width: 32px; height: 32px;
        border-radius: 50%; border: none; background: #f0f0f0; cursor: pointer;
        font-size: 16px; line-height: 1;
      }
      .ps-title { font-size: 19px; font-weight: 700; margin: 0 0 6px; }
      .ps-sub { font-size: 13.5px; color: #6b6b68; margin: 0 0 20px; }

      .ps-dropzone {
        border: 1.5px dashed #ccc; border-radius: 12px; padding: 30px 16px;
        text-align: center; cursor: pointer; margin-bottom: 16px;
      }
      .ps-dropzone:hover { border-color: #5E9A1E; }

      .ps-crop-wrap { position: relative; margin: 0 auto 16px; max-width: 100%; user-select: none; }
      .ps-crop-wrap img { display: block; max-width: 100%; max-height: 50vh; margin: 0 auto; }
      .ps-crop-box {
        position: absolute; border: 2px solid #5E9A1E;
        box-shadow: 0 0 0 2000px rgba(0,0,0,0.4);
        cursor: move;
      }
      .ps-handle {
        position: absolute; width: 16px; height: 16px; background: #5E9A1E;
        border: 2px solid #fff; border-radius: 50%;
      }
      .ps-handle.nw { top: -9px; left: -9px; cursor: nwse-resize; }
      .ps-handle.ne { top: -9px; right: -9px; cursor: nesw-resize; }
      .ps-handle.sw { bottom: -9px; left: -9px; cursor: nesw-resize; }
      .ps-handle.se { bottom: -9px; right: -9px; cursor: nwse-resize; }

      .ps-actions { display: flex; gap: 10px; margin-top: 8px; }
      .ps-btn {
        flex: 1; height: 44px; border-radius: 10px; border: none;
        background: #5E9A1E; color: #fff; font-weight: 700; font-size: 14.5px;
        cursor: pointer;
      }
      .ps-btn.secondary { background: #ececec; color: #333; }
      .ps-btn:disabled { opacity: .5; cursor: not-allowed; }

      .ps-status { font-size: 13.5px; color: #6b6b68; margin-top: 10px; text-align: center; }
      .ps-status.err { color: #c0392b; }

      .ps-results { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
      .ps-card { border-radius: 10px; overflow: hidden; border: 1px solid #eee; text-decoration: none; color: inherit; }
      .ps-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #f4f4f4; }
      .ps-card .ps-card-body { padding: 6px 8px; }
      .ps-card .ps-id { font-size: 11.5px; font-weight: 700; margin: 0; }
      .ps-card .ps-pct { font-size: 11px; color: #5E9A1E; margin: 2px 0 0; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ============== ВХІДНА КНОПКА ==============

  function renderEntryButtons() {
    CONFIG.ENTRY_SELECTORS.forEach(function (selector) {
      const el = document.querySelector(selector);
      if (!el) return;
      const btn = document.createElement('button');
      btn.className = 'ps-entry-btn';
      btn.innerHTML =
        '<span class="ps-entry-icon">🔍</span>' +
        '<span class="ps-entry-text"><b>Знайти схожий макет за фото</b>' +
        '<span>Завантаж референс — покажемо найближчі варіанти з каталогу</span></span>';
      btn.addEventListener('click', openModal);
      el.appendChild(btn);
    });
  }

  // ============== МОДАЛЬНЕ ВІКНО ==============

  let state = {
    overlay: null,
    imgEl: null,
    naturalW: 0,
    naturalH: 0,
    box: { x: 20, y: 20, w: 60, h: 60 }, // у відсотках від розміру картинки
    dragMode: null, // 'move' | 'nw' | 'ne' | 'sw' | 'se'
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
    state = { overlay: null, imgEl: null, naturalW: 0, naturalH: 0, box: { x: 20, y: 20, w: 60, h: 60 }, dragMode: null, dragStart: null };
  }

  function getBody() {
    return state.overlay.querySelector('.ps-body');
  }

  // --- Крок 1: завантаження файлу ---
  function renderUploadStep() {
    const body = getBody();
    body.innerHTML =
      '<div class="ps-dropzone">' +
      '  <p style="margin:0 0 6px;font-weight:600;">Натисни, щоб вибрати фото</p>' +
      '  <p style="margin:0;font-size:12.5px;color:#6b6b68;">JPG або PNG</p>' +
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
    reader.onload = function () {
      renderCropStep(reader.result);
    };
    reader.readAsDataURL(file);
  }

  // --- Крок 2: обрізка ---
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

  // Вирізає обрану ділянку з оригінального зображення й повертає base64 (без префіксу data:...)
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

  // --- Крок 3: пошук ---
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

      const a = document.createElement('a');
      a.className = 'ps-card';
      a.href = '#banery-' + entry.id; // якщо на сторінці є прив'язка до конкретного банера — підправ це посилання
      a.innerHTML =
        '<img src="' + imgSrc + '" alt="' + entry.id + '" loading="lazy">' +
        '<div class="ps-card-body">' +
        '  <p class="ps-id">' + entry.id + (title ? ' — ' + title : '') + '</p>' +
        '  <p class="ps-pct">' + pct + '% схожості</p>' +
        '</div>';
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

  // ============== СТАРТ ==============
  function init() {
    injectStyles();
    renderEntryButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
