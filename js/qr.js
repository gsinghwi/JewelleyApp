/* JewelleryApp - QR codes: generate per stock piece, print stickers, scan with the camera.
 * A piece's QR code holds just its tag number (e.g. T1001), so the same sticker works with a
 * phone/laptop camera here and with any USB/Bluetooth QR scanner gun typing into the scan box.
 * Libraries: js/vendor/qrcode-generator (MIT), js/vendor/jsQR (Apache-2.0).
 */
(function (global) {
  'use strict';
  const esc = U.esc;

  // Sticker formats (sizes in mm). Thermal label printers print one sticker per page.
  const FORMATS = {
    tag: { label: 'Jewellery tag (dumbbell) 95 x 12 mm - thermal printer', page: '95mm 12mm', w: 95, h: 12, qr: 10, cls: 'st-tag' },
    l50: { label: 'Label 50 x 25 mm - thermal printer', page: '50mm 25mm', w: 50, h: 25, qr: 21, cls: 'st-l50' },
    a4: { label: 'A4 sheet, 65 labels (38 x 21 mm) - office printer', page: 'A4', w: 38.1, h: 21.2, qr: 16, cls: 'st-a4', sheet: true },
  };

  const QR = {
    FORMATS,

    // ecc: error correction level. 'L' keeps longer texts (e.g. pawn packets) small enough for stickers.
    svg(text, ecc) {
      const q = global.qrcode(0, ecc || 'M');
      q.addData(String(text));
      q.make();
      return q.createSvgTag({ cellSize: 1, margin: 1, scalable: true });
    },

    dataURL(text, cell) {
      const q = global.qrcode(0, 'M');
      q.addData(String(text));
      q.make();
      return q.createDataURL(cell || 8, (cell || 8) * 2);
    },

    pieceInfo(p) {
      const it = Biz.item(p.itemId);
      return {
        tag: p.tagNo, item: it.name, fixed: it.pricing === 'FIXED',
        purity: it.pricing === 'FIXED' ? '' : Biz.purityName(p.purityId),
        gross: U.num(p.grossWt), net: U.num(p.netWt), huid: p.huid || '',
        mrp: it.pricing === 'FIXED' ? U.inr(p.fixedPrice, { whole: true }) : '',
        stone: U.n(p.stoneValue) ? 'St ' + U.inr(p.stoneValue, { whole: true }) : '',
      };
    },

    sticker(p, fmt, show) {
      const i = QR.pieceInfo(p);
      const shop = DB.settings.shopName || '';
      const wt = i.fixed ? (i.mrp ? 'MRP ' + i.mrp : '') : 'G ' + i.gross + ' N ' + i.net;
      const details = [
        show.item ? '<span>' + esc(i.item) + '</span>' : '',
        show.purity && i.purity ? '<span>' + esc(i.purity) + '</span>' : '',
        show.weight && wt ? '<span>' + esc(wt) + '</span>' : '',
        show.huid && i.huid ? '<span>HUID ' + esc(i.huid) + '</span>' : '',
        show.stone && i.stone ? '<span>' + esc(i.stone) + '</span>' : '',
      ].join('');
      const shopLine = show.shop ? '<b class="st-shop">' + esc(shop) + '</b>' : '';
      const tagLine = '<b class="st-no">' + esc(i.tag) + '</b>';
      if (fmt === 'tag') {
        // Left flap: QR + tag no. Right flap: up to 3 short lines (no room for the shop name).
        // The tail in the middle stays blank.
        const compact = [
          show.item ? i.item : '',
          [show.purity ? i.purity : '', show.weight ? wt : ''].filter(Boolean).join(' \u00B7 '),
          [show.huid && i.huid ? 'HUID ' + i.huid : '', show.stone ? i.stone : ''].filter(Boolean).join(' \u00B7 '),
        ].filter(Boolean).map((t) => '<span>' + esc(t) + '</span>').join('');
        return '<div class="sticker st-tag"><div class="flap"><div class="st-qr">' + QR.svg(i.tag) + '</div>' + tagLine + '</div>' +
          '<div class="tail"></div><div class="flap st-text">' + compact + '</div></div>';
      }
      return '<div class="sticker ' + FORMATS[fmt].cls + '"><div class="st-qr">' + QR.svg(i.tag) + '</div><div class="st-text">' + shopLine + tagLine + details + '</div></div>';
    },

    sheetHtml(pieces, fmt, show, copies) {
      const f = FORMATS[fmt];
      const list = [];
      pieces.forEach((p) => { for (let c = 0; c < (copies || 1); c++) list.push(p); });
      return QR.pageCss(fmt) + '<div class="stickers ' + (f.sheet ? 'sheet' : 'roll') + '">' + list.map((p) => QR.sticker(p, fmt, show)).join('') + '</div>';
    },

    pageCss(fmt) {
      const f = FORMATS[fmt];
      return '<style>@page { size: ' + f.page + '; margin: ' + (f.sheet ? '10.7mm 4.65mm' : '0') + '; }</style>';
    },

    /* Generic QR labels: [{ qr, title, lines: [] }] on 50x25 mm or A4 sheet stickers */
    label(l, fmt) {
      return '<div class="sticker ' + FORMATS[fmt].cls + '"><div class="st-qr">' + QR.svg(l.qr, 'L') + '</div><div class="st-text">' +
        '<b class="st-no">' + esc(l.title) + '</b>' + l.lines.filter(Boolean).map((t) => '<span>' + esc(t) + '</span>').join('') + '</div></div>';
    },

    printLabels(labels, title) {
      const fields = [
        { name: 'fmt', label: 'Sticker type', type: 'select', required: true, full: true, options: ['l50', 'a4'].map((k) => ({ value: k, label: FORMATS[k].label })) },
        { name: 'copies', label: 'Copies', type: 'number', min: 1, required: true },
      ];
      const m = UI.modal({
        title: title || 'Print QR labels', size: 'wide',
        body: UI.formHtml(fields, { fmt: 'l50', copies: 1 }) + '<h4 class="sub">Preview (actual size)</h4><div class="sticker-preview"></div>',
        actions: [{ label: 'Cancel' }, {
          label: 'Print', cls: 'btn primary', onClick: (el) => {
            const d = UI.readForm(el, fields);
            if (!d) return false;
            const copies = Math.max(1, Math.min(20, Math.round(U.n(d.copies) || 1)));
            const list = [];
            labels.forEach((l) => { for (let i = 0; i < copies; i++) list.push(l); });
            UI.print(QR.pageCss(d.fmt) + '<div class="stickers ' + (FORMATS[d.fmt].sheet ? 'sheet' : 'roll') + '">' + list.map((l) => QR.label(l, d.fmt)).join('') + '</div>');
          },
        }],
      });
      const preview = () => {
        const d = UI.readForm(m.el, fields) || { fmt: 'l50' };
        m.el.querySelector('.sticker-preview').innerHTML = '<div class="stickers preview ' + (FORMATS[d.fmt].sheet ? 'sheet' : 'roll') + '">' +
          labels.slice(0, 2).map((l) => QR.label(l, d.fmt)).join('') + '</div>';
      };
      m.el.querySelector('form').addEventListener('input', preview);
      preview();
    },

    /* Dialog to choose sticker format and fields, preview, then print */
    printDialog(pieces) {
      if (!pieces.length) { UI.toast('No pieces to print', 'error'); return; }
      let prefs = { fmt: 'tag', copies: 1, shop: true, item: true, purity: true, weight: true, huid: true, stone: false };
      try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem('jewelleryapp.qrprefs') || '{}')); } catch (e) { /* defaults */ }
      const fields = [
        { name: 'fmt', label: 'Sticker type', type: 'select', required: true, full: true, options: Object.keys(FORMATS).map((k) => ({ value: k, label: FORMATS[k].label })) },
        { name: 'copies', label: 'Copies per piece', type: 'number', min: 1, required: true },
        { name: 'shop', label: 'Shop name (not on the small dumbbell tag)', type: 'checkbox' },
        { name: 'item', label: 'Item name', type: 'checkbox' },
        { name: 'purity', label: 'Purity', type: 'checkbox' },
        { name: 'weight', label: 'Gross / net weight (MRP for fixed price items)', type: 'checkbox' },
        { name: 'huid', label: 'HUID', type: 'checkbox' },
        { name: 'stone', label: 'Stone value', type: 'checkbox' },
      ];
      const m = UI.modal({
        title: 'Print QR stickers (' + pieces.length + ' piece' + (pieces.length > 1 ? 's' : '') + ')', size: 'wide',
        body: UI.formHtml(fields, prefs) + '<h4 class="sub">Preview (actual size)</h4><div class="sticker-preview"></div>' +
          '<p class="muted small">Thermal label printers (TSC, Zebra, Argox, TVS...): in the print window choose the label printer, set the paper size to the sticker size and margins to none. A4 sheets: set scale to 100% (Actual size).</p>',
        actions: [{ label: 'Cancel' }, {
          label: 'Print', cls: 'btn primary', onClick: (el) => {
            const d = UI.readForm(el, fields);
            if (!d) return false;
            d.copies = Math.max(1, Math.min(20, Math.round(U.n(d.copies) || 1)));
            try { localStorage.setItem('jewelleryapp.qrprefs', JSON.stringify(d)); } catch (e) { /* not saved */ }
            UI.print(QR.sheetHtml(pieces, d.fmt, d, d.copies));
          },
        }],
      });
      const preview = () => {
        const d = UI.readForm(m.el, fields) || prefs;
        m.el.querySelector('.sticker-preview').innerHTML = '<div class="stickers preview ' + (FORMATS[d.fmt].sheet ? 'sheet' : 'roll') + '">' +
          pieces.slice(0, 3).map((p) => QR.sticker(p, d.fmt, d)).join('') + '</div>';
      };
      m.el.querySelector('form').addEventListener('input', preview);
      preview();
    },

    /* One piece: big QR with details, print or save the image */
    show(p) {
      const i = QR.pieceInfo(p);
      UI.modal({
        title: 'QR code - ' + p.tagNo,
        body: '<div class="qr-show"><div class="qr-big">' + QR.svg(p.tagNo) + '</div><div><h3>' + esc(i.item) + '</h3><dl class="info">' +
          [['Tag no', i.tag], ['Purity', i.purity], ['Gross / net', i.fixed ? '' : i.gross + ' / ' + i.net + ' g'], ['MRP', i.mrp], ['HUID', i.huid], ['Location', p.location]]
            .filter((x) => x[1]).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') +
          '</dl><p class="muted small">The code contains the tag number <b>' + esc(p.tagNo) + '</b>. Scan it on the billing screen to add this piece to a bill.</p></div></div>',
        actions: [
          { label: 'Close' },
          { label: 'Download image', cls: 'btn', onClick: () => { const a = document.createElement('a'); a.href = QR.dataURL(p.tagNo); a.download = 'QR-' + p.tagNo + '.gif'; a.click(); return false; } },
          { label: 'Print sticker', cls: 'btn primary', onClick: () => { QR.printDialog([p]); } },
        ],
      });
    },

    beep() {
      try {
        const ctx = new (global.AudioContext || global.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 1200; g.gain.value = 0.08;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.12);
        o.onended = () => ctx.close();
      } catch (e) { /* no audio */ }
    },

    decodeImageData(img) {
      const res = global.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      return res ? res.data : null;
    },

    /* Camera scanner. onCode(text) returns {ok, message} for the scan list; keeps scanning until closed. */
    scanner(onCode) {
      let stream = null, raf = 0, stopped = false, last = '', lastAt = 0, detector = null;
      const added = new Set(); // codes accepted in this session; seeing them again is not an error
      const m = UI.modal({
        title: 'Scan QR code', size: 'wide',
        body: '<div class="scanner"><div class="scan-view"><video playsinline muted></video><div class="scan-frame"></div></div>' +
          '<div class="scan-side"><p class="scan-msg muted">Starting camera...</p>' +
          '<label class="btn sm file-btn">Scan from a photo<input type="file" accept="image/*" capture="environment" hidden></label>' +
          '<h4 class="sub">Scanned</h4><ul class="list scan-list"><li class="muted">Nothing yet</li></ul></div></div>' +
          '<p class="muted small">Hold the sticker 10-20 cm from the camera. Pieces are added to the bill as they are scanned. A USB/Bluetooth QR scanner also works: just scan into the "Scan barcode" box on the billing screen.</p>',
        actions: [{ label: 'Done', cls: 'btn primary' }],
      });
      const el = m.el;
      const video = el.querySelector('video');
      const canvas = document.createElement('canvas');
      const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
      const msg = (t, cls) => { const p = el.querySelector('.scan-msg'); p.textContent = t; p.className = 'scan-msg ' + (cls || 'muted'); };
      const list = el.querySelector('.scan-list');

      const handle = (text) => {
        text = String(text || '').trim();
        if (!text) return;
        const now = Date.now();
        if (text === last && now - lastAt < 2500) return; // same sticker still in view
        last = text; lastAt = now;
        if (added.has(text)) return;
        const res = onCode(text) || {};
        if (res.ok) { added.add(text); QR.beep(); }
        if (list.querySelector('.muted')) list.innerHTML = '';
        list.insertAdjacentHTML('afterbegin', '<li class="' + (res.ok ? 'ok' : 'err') + '"><b>' + esc(text) + '</b> ' + esc(res.message || '') + '</li>');
      };

      const stop = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach((t) => t.stop());
      };
      const obs = new MutationObserver(() => { if (!document.body.contains(el)) { stop(); obs.disconnect(); } });
      obs.observe(document.body, { childList: true });

      let lastScan = 0;
      const tick = async () => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - lastScan < 150 || video.readyState < 2) return;
        lastScan = now;
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]) handle(codes[0].rawValue);
          } else {
            const w = video.videoWidth, h = video.videoHeight;
            const scale = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
            ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
            const code = QR.decodeImageData(ctx2d.getImageData(0, 0, canvas.width, canvas.height));
            if (code) handle(code);
          }
        } catch (e) { /* keep scanning */ }
      };

      (async () => {
        try {
          if ('BarcodeDetector' in global) {
            const formats = await global.BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) detector = new global.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch (e) { detector = null; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          msg('Camera is not available here. Open the app over https (e.g. the GitHub Pages link) or use "Scan from a photo".', 'warn-text');
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream;
          await video.play();
          msg('Point the camera at a QR sticker');
          tick();
        } catch (e) {
          msg(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site in the browser, or use "Scan from a photo".' :
            e.name === 'NotFoundError' ? 'No camera found on this device. Use "Scan from a photo" or a USB QR scanner.' : 'Could not start camera: ' + e.message, 'warn-text');
        }
      })();

      el.querySelector('input[type=file]').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
          canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
          ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
          const code = QR.decodeImageData(ctx2d.getImageData(0, 0, canvas.width, canvas.height));
          URL.revokeObjectURL(img.src);
          if (code) { last = ''; handle(code); } else UI.toast('No QR code found in that photo', 'error');
        };
        img.src = URL.createObjectURL(f);
      });
      return m;
    },
  };

  global.QR = QR;
})(window);
