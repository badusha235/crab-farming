// Crab Box Register - Application Controller
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var STATUS = {
    growing:  { label: 'Growing',   cls: 's-growing',  dot: 'k-growing' },
    molting:  { label: 'Moulting',  cls: 's-molting',  dot: 'k-molting' },
    harvest:  { label: 'Harvest',   cls: 's-harvest',  dot: 'k-harvest' },
    dead:     { label: 'Dead',      cls: 's-dead',     dot: 'k-dead' }
  };

  var DEFAULT_SPECIES = [
    'Mud crab (Scylla serrata)',
    'Orange mud crab (Scylla olivacea)',
    'Green mud crab (Scylla paramamosain)',
    'Blue swimmer crab (Portunus pelagicus)',
    'Other'
  ];

  var TABS = ['inventory', 'boxes', 'harvest', 'monitor'];
  var COLORS = ['#1B7F9E', '#C8361F', '#4C8A25', '#8A5CC2', '#C98A00', '#4B5D67'];
  var RANGES = [['24 hours', 864e5], ['7 days', 7 * 864e5], ['30 days', 30 * 864e5]];

  // Application State
  var S = {
    boxes: {},       // map box_no -> box
    inventory: [],   // list of inventory crabs
    deliveries: [],
    harvests: [],    // list of harvests
    profits: [],     // profit by batch
    readings: [],    // monitor readings
    settings: { farm_name: 'Vertical Crab Farm Kochi', box_count: 40, temp_min: 26, temp_max: 32, ph_min: 7.5, ph_max: 8.5 },
    species: DEFAULT_SPECIES.slice(),
    tab: 'boxes',    // Open on Boxes!
    filter: 'all',   // Box filter: all, growing, molting, empty, harvest, dead
    q: '',           // Box search query
    iFilter: 'stock',// Inventory filter: stock, moved, all
    iSel: {},        // Selected inventory crabs map: id -> bool
    range: 7 * 864e5,// Monitor chart range
    openBoxNo: null,
    draftBox: null,
    isNewBox: false,
    boxDelArmed: false,
    hEditId: null,
    hDelArmed: false,
    hSel: {},
    hWTouched: false,
    hFiles: [],
    hUploaded: [],
    saving: false,
    hSubTab: 'lots',     // Harvest sub-tab: 'lots' or 'profit'
    profitPage: 1,       // current page for profit table
    profitPageSize: 20,  // rows per page
    iSubTab: 'crabs',    // Inventory sub-tab: 'crabs' or 'deliv'
    invPage: 1,          // current page for inventory crabs table
    invPageSize: 20,     // rows per page for inventory crabs table
    delivPage: 1,        // current page for deliveries table
    delivPageSize: 20,   // rows per page for deliveries table
    hSelLots: {},        // Selected harvest lots map: id -> bool
    harvestPage: 1,      // current page for harvest lots table
    harvestPageSize: 20  // rows per page for harvest lots table
  };

  /* ---------- Helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymdOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymdOf(new Date()); }
  function ymd(s) { var p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function dayDiff(a, b) { return Math.round((ymd(b) - ymd(a)) / 864e5); }

  // Date formatting: 23 Nov 2026
  function fmtDate(s) {
    if (!s) return '';
    var p = String(s).slice(0, 10).split('-').map(Number);
    if (p.length < 3 || isNaN(p[0])) return String(s);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDT(ms) {
    return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function fmtAgo(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return fmtDT(ms);
  }

  // Weight conversions: stored in grams, shown and entered in kg (3 decimals allowed)
  function toKg(g) { return Number(((g || 0) / 1000).toFixed(3)); }
  function fmtKg(g) { return String(toKg(g)); }
  function kgToG(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
  }

  // Indian Rupee formatting with Indian digit grouping: 1,44,008
  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function nowLocalInput() {
    var d = new Date();
    return ymdOf(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var toastTimer;
  function toast(msg, type) {
    var t = $('#toast');
    if (!t) return;
    var isErr = type === 'error' || /error|failed|cannot|could not|negative|invalid/i.test(msg);
    var isSuccess = type === 'success' || /deleted|saved|created|received|moved|updated|success/i.test(msg);

    var icon = isErr ? '⚠️' : (isSuccess ? '✅' : 'ℹ️');
    t.className = 'toast' + (isErr ? ' toast-error' : (isSuccess ? ' toast-success' : ''));
    t.textContent = '';
    var icSpan = document.createElement('span');
    icSpan.className = 'toast-icon';
    icSpan.textContent = icon;
    var txSpan = document.createElement('span');
    txSpan.textContent = msg;
    t.appendChild(icSpan);
    t.appendChild(txSpan);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }

  // Two Large Coloured Buttons Sex Picker (Male Blue / Female Pink)
  function setupSexPicker(container, initialValue, onChange) {
    container.textContent = '';
    container.className = 'sexseg';
    container.setAttribute('role', 'group');
    var cur = initialValue || '';
    var btns = [];

    function paint() {
      btns.forEach(function (b) {
        var v = b.getAttribute('data-sex');
        var on = v === cur;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.className = on ? (v === 'M' ? 's-male' : 's-female') : '';
      });
    }

    [['M', 'Male'], ['F', 'Female']].forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt[1];
      btn.setAttribute('data-sex', opt[0]);
      btn.addEventListener('click', function () {
        cur = (cur === opt[0]) ? '' : opt[0]; // tap again to clear!
        paint();
        if (onChange) onChange(cur);
      });
      container.appendChild(btn);
      btns.push(btn);
    });

    paint();
    return {
      set: function (v) { cur = v || ''; paint(); },
      get: function () { return cur; }
    };
  }

  function sexTag(v) {
    var s = document.createElement('span');
    if (!v) { s.textContent = '–'; return s; }
    s.className = 'stag ' + (v === 'M' ? 'm' : 'f');
    s.textContent = v === 'M' ? 'Male' : 'Female';
    return s;
  }

  // Derive Box metrics: age in days, current weight, gain, gain/day
  function deriveBox(b) {
    var t = today();
    var ended = (b.status === 'harvest' || b.status === 'dead') && b.end_date;
    var end = ended ? b.end_date : t;
    var stocked = !!b.stock_date;
    var age = stocked ? Math.max(0, dayDiff(b.stock_date, end)) : 0;

    var ws = (b.weights || []).slice().sort(function (x, y) { return (x.weighed_on || '').localeCompare(y.weighed_on || ''); });
    var last = ws.length ? ws[ws.length - 1] : null;
    var w0 = Number(b.initial_weight_g) || 0;
    var cur = last ? Number(last.weight_g) : w0;
    var gain = cur - w0;
    var days = stocked ? dayDiff(b.stock_date, last ? last.weighed_on : end) : 0;
    var adg = last && days > 0 ? (gain / days) : null;

    return { age: age, cur: cur, w0: w0, gain: gain, days: days, adg: adg, hasLast: !!last };
  }

  function maxBoxNum() {
    var m = S.settings.box_count || 40;
    Object.keys(S.boxes).forEach(function (k) {
      var n = parseInt(k, 10);
      if (n > m) m = n;
    });
    return m;
  }

  function emptyBoxNumbers() {
    var out = [], tot = maxBoxNum();
    for (var n = 1; n <= tot; n++) {
      if (!S.boxes[n]) out.push(n);
    }
    return out;
  }

  function usedBatchNumbers(excludeCrabId, excludeBoxNo) {
    var map = {};
    (S.inventory || []).forEach(function (c) {
      if (c.status === 'stock' && c.batch_no && c.id !== excludeCrabId) {
        map[c.batch_no.trim().toLowerCase()] = 'the inventory';
      }
    });
    Object.keys(S.boxes).forEach(function (k) {
      var b = S.boxes[k];
      if (b && b.batch_no && b.box_no !== excludeBoxNo) {
        map[b.batch_no.trim().toLowerCase()] = 'Box ' + b.box_no;
      }
    });
    return map;
  }

  function nextBatchNumbers(count, usedMap) {
    var seen = Object.assign({}, usedMap), out = [], n = 1;
    while (out.length < count && n < 100000) {
      var v = 'B-' + (n < 10 ? '00' + n : n < 100 ? '0' + n : String(n));
      var k = v.toLowerCase();
      if (!seen[k]) {
        out.push(v);
        seen[k] = 1;
      }
      n++;
    }
    return out;
  }

  function strip(containerSel, cells) {
    var host = $(containerSel);
    if (!host) return;
    host.textContent = '';
    cells.forEach(function (c) {
      var d = document.createElement('div'); d.className = 'stat';
      var k = document.createElement('div'); k.className = 'k'; k.textContent = c[0];
      var v = document.createElement('div'); v.className = 'v'; v.textContent = c[1];
      if (c[2]) {
        var u = document.createElement('small'); u.textContent = c[2]; v.appendChild(u);
      }
      d.appendChild(k); d.appendChild(v); host.appendChild(d);
    });
  }

  /* ---------- Sync and Header ---------- */
  function renderHeader() {
    $('#farm').textContent = S.settings.farm_name || 'Vertical crab farm';
    var userDisplay = $('#user-display');
    if (userDisplay) {
      var user = window.CrabApi.getUser();
      userDisplay.textContent = user ? ('👤 ' + user.name + ' (' + user.role + ')') : '';
    }
  }

  /* ---------- 1. BOXES TAB (Opens by default) ---------- */
  function renderBoxesStats() {
    var total = maxBoxNum(), growing = 0, wSum = 0, aSum = 0, recs = 0;
    Object.keys(S.boxes).forEach(function (k) {
      var b = S.boxes[k];
      if (!b) return;
      recs++;
      if (b.status === 'growing' || b.status === 'molting') {
        var d = deriveBox(b);
        growing++;
        wSum += d.cur;
        aSum += d.age;
      }
    });

    strip('#stats', [
      ['Boxes', total, ''],
      ['Crabs growing', growing, ''],
      ['Empty boxes', total - recs, ''],
      ['Avg weight', growing ? fmtKg(wSum / growing) : '–', growing ? 'kg' : ''],
      ['Avg age', growing ? Math.round(aSum / growing) : '–', growing ? 'days' : '']
    ]);
  }

  function renderBoxesChips() {
    var total = maxBoxNum();
    var counts = { all: total, empty: 0, growing: 0, molting: 0, harvest: 0, dead: 0 };
    for (var n = 1; n <= total; n++) {
      var b = S.boxes[n];
      var st = b ? b.status : 'empty';
      counts[st] = (counts[st] || 0) + 1;
    }

    var defs = [
      ['all', 'All'],
      ['growing', 'Growing'],
      ['molting', 'Moulting'],
      ['empty', 'Empty'],
      ['harvest', 'Harvest'],
      ['dead', 'Dead']
    ];

    var host = $('#chips'); host.textContent = '';
    defs.forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('aria-pressed', S.filter === d[0] ? 'true' : 'false');
      if (d[0] !== 'all') {
        var dot = document.createElement('span');
        dot.className = 'dot k-' + d[0];
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(d[1]));
      var c = document.createElement('span'); c.className = 'c'; c.textContent = counts[d[0]] || 0;
      btn.appendChild(c);
      btn.addEventListener('click', function () {
        S.filter = d[0];
        renderBoxesGrid();
      });
      host.appendChild(btn);
    });
  }

  function renderBoxesGrid() {
    renderBoxesStats();
    renderBoxesChips();

    var host = $('#grid'); host.textContent = '';
    var total = maxBoxNum(), shown = 0, q = (S.q || '').trim();

    for (var n = 1; n <= total; n++) {
      var rec = S.boxes[n];
      var stKey = rec ? rec.status : 'empty';
      if (S.filter !== 'all' && stKey !== S.filter) continue;
      if (q && String(n).indexOf(q) === -1) continue;
      shown++;

      var tile = document.createElement('button');
      tile.type = 'button';
      var topRow = document.createElement('div'); topRow.className = 'top-row';
      var nn = document.createElement('span'); nn.className = 'n'; nn.textContent = n;
      var st = document.createElement('span'); st.className = 'st';
      var meta = document.createElement('div'); meta.className = 'meta';

      if (rec) {
        var d = deriveBox(rec);
        var info = STATUS[rec.status] || STATUS.growing;
        tile.className = 'tile ' + info.cls;
        st.textContent = info.label;

        var bWeight = document.createElement('b');
        bWeight.textContent = fmtKg(d.cur);
        meta.appendChild(bWeight);
        meta.appendChild(document.createTextNode(' kg · ' + (rec.status === 'harvest' && rec.size ? rec.size : d.age + ' d')));
        tile.setAttribute('aria-label', 'Box ' + n + ', ' + info.label + ', ' + fmtKg(d.cur) + ' kg');
      } else {
        tile.className = 'tile empty';
        st.textContent = 'Empty';
        meta.textContent = 'Tap to stock';
        tile.setAttribute('aria-label', 'Box ' + n + ', empty');
      }

      topRow.appendChild(nn);
      topRow.appendChild(st);
      tile.appendChild(topRow);
      tile.appendChild(meta);

      if (rec && rec.batch_no) {
        var bnl = document.createElement('div');
        bnl.className = 'bn';
        bnl.textContent = rec.batch_no;
        tile.appendChild(bnl);
      }

      (function (num_) {
        tile.addEventListener('click', function () { openBoxSheet(num_); });
      })(n);

      host.appendChild(tile);
    }

    var hint = $('#hint');
    var totalRecs = Object.keys(S.boxes).length;
    if (totalRecs === 0 && !q && S.filter === 'all') {
      hint.textContent = 'No crabs in boxes. Tap an empty box to stock a crab, or go to Inventory to receive deliveries and move them into boxes.';
    } else if (!shown) {
      hint.textContent = 'No boxes match this filter.';
    } else {
      hint.textContent = '';
    }
  }

  /* ---------- Box Slide-in Sheet ---------- */
  var boxSexPicker = null;

  function populateSpeciesDropdown(selectEl, selectedVal) {
    selectEl.textContent = '';
    var list = S.species.slice();
    if (selectedVal && list.indexOf(selectedVal) === -1) list.push(selectedVal);
    list.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      selectEl.appendChild(opt);
    });
    selectEl.value = selectedVal || list[0];
  }

  function setBoxSheetStatusUI() {
    var cur = S.draftBox.status;
    document.querySelectorAll('#seg button').forEach(function (btn) {
      var st = btn.getAttribute('data-status');
      var on = st === cur;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.className = on ? STATUS[st].cls : '';
    });
    $('#size-field').hidden = (cur !== 'harvest');
  }

  function openBoxSheet(num) {
    var rec = S.boxes[num];
    S.openBoxNo = num;
    S.isNewBox = !rec;
    S.boxDelArmed = false;

    if (rec) {
      S.draftBox = JSON.parse(JSON.stringify(rec));
    } else {
      var freeBatches = nextBatchNumbers(1, usedBatchNumbers());
      S.draftBox = {
        box_no: num,
        status: 'growing',
        size: '',
        species: S.species[0],
        sex: '',
        batch_no: freeBatches[0] || 'B-001',
        cost: '',
        source: '',
        stock_date: today(),
        initial_weight_g: '',
        weights: [],
        moults: [],
        notes: '',
        end_date: ''
      };
    }

    var d = S.draftBox;
    d.weights = d.weights || [];
    d.moults = d.moults || [];

    $('#sheet-title').textContent = 'Box ' + num;
    $('#sheet-sub').textContent = rec
      ? 'Last updated: ' + (rec.updated_at ? fmtDate(rec.updated_at) : today())
      : 'Empty. Record the crab you are stocking.';

    $('#f-w0').value = d.initial_weight_g ? toKg(d.initial_weight_g) : '';
    $('#f-date').value = d.stock_date ? d.stock_date.slice(0, 10) : today();
    boxSexPicker.set(d.sex || '');
    populateSpeciesDropdown($('#f-species'), d.species);
    $('#f-bn').value = d.batch_no || '';
    $('#f-cost').value = typeof d.cost === 'number' ? d.cost : '';
    $('#f-batch').value = d.source || '';
    $('#f-notes').value = d.notes || '';
    $('#f-size').value = d.size || '';

    $('#w-date').value = today();
    $('#w-g').value = '';

    $('#btn-del').hidden = S.isNewBox;
    $('#btn-del').textContent = 'Delete record';
    $('#btn-bmove').hidden = S.isNewBox;

    setBoxSheetStatusUI();
    renderBoxGrowthLog();
    renderBoxMoults();

    $('#scrim').hidden = false;
    $('#sheet').hidden = false;
    $('#sheet-title').focus();
  }

  function closeBoxSheet() {
    S.openBoxNo = null;
    S.draftBox = null;
    $('#sheet').hidden = true;
    $('#scrim').hidden = true;
  }

  function renderBoxGrowthLog() {
    var d = S.draftBox;
    var host = $('#log'); host.textContent = '';
    var w0 = num(d.initial_weight_g);

    function createLogRow(dateStr, gVal, delta, idx) {
      var row = document.createElement('div'); row.className = 'log-row';
      var dSpan = document.createElement('span'); dSpan.className = 'd'; dSpan.textContent = dateStr;
      var gSpan = document.createElement('span'); gSpan.className = 'g'; gSpan.textContent = fmtKg(gVal) + ' kg';
      var dlSpan = document.createElement('span'); dlSpan.className = 'dl';
      if (delta !== null) {
        dlSpan.textContent = (delta >= 0 ? '+' : '−') + fmtKg(Math.abs(delta)) + ' kg';
        if (delta < 0) dlSpan.className = 'dl neg';
      }
      row.appendChild(dSpan); row.appendChild(gSpan); row.appendChild(dlSpan);

      if (idx === null) {
        row.appendChild(document.createElement('span'));
      } else {
        var xBtn = document.createElement('button'); xBtn.type = 'button'; xBtn.className = 'x'; xBtn.textContent = '×';
        xBtn.setAttribute('aria-label', 'Remove weighing');
        xBtn.addEventListener('click', function () {
          d.weights.splice(idx, 1);
          renderBoxGrowthLog();
        });
        row.appendChild(xBtn);
      }
      host.appendChild(row);
    }

    var prev = null;
    if (w0 !== null && d.stock_date) {
      createLogRow(fmtDate(d.stock_date) + ' (stocked)', w0, null, null);
      prev = w0;
    }

    d.weights.forEach(function (w, i) {
      var wg = Number(w.weight_g);
      createLogRow(fmtDate(w.weighed_on), wg, prev === null ? null : (wg - prev), i);
      prev = wg;
    });

    if (!host.firstChild) {
      var emptyMsg = document.createElement('div'); emptyMsg.className = 'log-empty';
      emptyMsg.textContent = 'Enter initial weight and stocking date, then add weighings as the crab grows.';
      host.appendChild(emptyMsg);
    }

    // Summary calculation
    var dv = deriveBox({
      status: d.status,
      stock_date: d.stock_date,
      initial_weight_g: w0 || 0,
      weights: d.weights,
      end_date: d.end_date
    });

    var summaryEl = $('#summary');
    if (d.stock_date && w0) {
      var txt = 'Age ' + dv.age + ' days';
      if (dv.hasLast) {
        txt += ' · now ' + fmtKg(dv.cur) + ' kg · ' + (dv.gain >= 0 ? '+' : '−') + fmtKg(Math.abs(dv.gain)) + ' kg';
        if (dv.adg !== null) {
          txt += ' · ' + (dv.adg >= 0 ? '' : '−') + Number((Math.abs(dv.adg) / 1000).toFixed(4)) + ' kg/day';
        }
      }
      summaryEl.textContent = txt;
    } else {
      summaryEl.textContent = '';
    }
  }

  function renderBoxMoults() {
    var host = $('#moults'); host.textContent = '';
    var d = S.draftBox;
    if (!d.moults || !d.moults.length) {
      var p = document.createElement('span'); p.className = 'muted'; p.textContent = 'None recorded';
      host.appendChild(p);
      return;
    }
    d.moults.forEach(function (mDate, i) {
      var c = document.createElement('span'); c.className = 'mchip';
      c.appendChild(document.createTextNode(fmtDate(mDate)));
      var x = document.createElement('button'); x.type = 'button'; x.textContent = '×';
      x.setAttribute('aria-label', 'Remove moult ' + fmtDate(mDate));
      x.addEventListener('click', function () {
        d.moults.splice(i, 1);
        renderBoxMoults();
      });
      c.appendChild(x);
      host.appendChild(c);
    });
    var tot = document.createElement('span'); tot.className = 'muted';
    tot.textContent = d.moults.length + (d.moults.length === 1 ? ' moult' : ' moults');
    host.appendChild(tot);
  }

  function collectBoxInputs() {
    var d = S.draftBox;
    var wG = kgToG($('#f-w0').value);
    d.initial_weight_g = wG || 0;
    d.stock_date = $('#f-date').value;
    d.sex = boxSexPicker.get();
    d.batch_no = $('#f-bn').value.trim();
    d.cost = $('#f-cost').value !== '' ? parseFloat($('#f-cost').value) : null;
    d.species = $('#f-species').value;
    d.source = $('#f-batch').value.trim();
    d.notes = $('#f-notes').value.trim();
    d.size = $('#f-size').value;
  }

  async function saveBox() {
    if (S.saving) return;
    collectBoxInputs();
    var d = S.draftBox;

    if (!d.initial_weight_g || d.initial_weight_g <= 0) {
      toast('Enter the initial weight in kg (must be greater than 0).');
      $('#f-w0').focus(); return;
    }
    if (!d.stock_date) {
      toast('Pick the stocking date.'); $('#f-date').focus(); return;
    }
    // Business rule: Harvest status needs a size!
    if (d.status === 'harvest' && !d.size) {
      toast('Crab size is required when status is Harvest.');
      $('#f-size').focus(); return;
    }

    var usedMap = usedBatchNumbers(null, d.box_no);
    if (d.batch_no && usedMap[d.batch_no.toLowerCase()]) {
      toast('Batch number ' + d.batch_no + ' is already in use in ' + usedMap[d.batch_no.toLowerCase()] + '.');
      $('#f-bn').focus(); return;
    }

    if (d.cost !== null && d.cost < 0) {
      toast('Purchase cost cannot be negative.');
      $('#f-cost').focus(); return;
    }

    S.saving = true;
    $('#btn-save').disabled = true;

    try {
      var saved = await window.CrabApi.saveBox(d.box_no, d);
      S.boxes[d.box_no] = saved;
      closeBoxSheet();
      renderAll();
      toast('Box ' + d.box_no + ' saved');
    } catch (err) {
      toast('Could not save box: ' + err.message);
    } finally {
      S.saving = false;
      $('#btn-save').disabled = false;
    }
  }

  async function deleteBox() {
    if (!S.boxDelArmed) {
      S.boxDelArmed = true;
      $('#btn-del').textContent = 'Tap again to delete';
      setTimeout(function () {
        if (S.boxDelArmed) {
          S.boxDelArmed = false;
          $('#btn-del').textContent = 'Delete record';
        }
      }, 4000);
      return;
    }

    var num = S.openBoxNo;
    S.boxDelArmed = false;
    try {
      await window.CrabApi.deleteBox(num);
      delete S.boxes[num];
      closeBoxSheet();
      renderAll();
      toast('Box ' + num + ' is now empty');
    } catch (err) {
      toast('Could not delete box: ' + err.message);
    }
  }

  // Move crab to another box
  function openMoveBoxModal() {
    var rec = S.boxes[S.openBoxNo];
    if (!rec) return;
    var free = emptyBoxNumbers();
    $('#bm-title').textContent = 'Move Box ' + rec.box_no + ' to another box';
    $('#bm-sub').textContent = (rec.batch_no ? rec.batch_no + ' moves' : 'The crab moves') +
      ' with its cost, weights, moults and notes. Old box becomes empty.';
    $('#bm-n').value = free.length ? free[0] : '';
    $('#bm-calc').textContent = free.length + ' empty ' + (free.length === 1 ? 'box' : 'boxes') + ' available';
    $('#bmove-modal').hidden = false;
    $('#bm-n').focus();
  }

  async function saveBoxMove() {
    var from = S.openBoxNo;
    var target = parseInt($('#bm-n').value, 10);
    if (!target || target < 1 || target > 500) {
      toast('Enter a box number between 1 and 500.');
      $('#bm-n').focus(); return;
    }
    if (target === from) {
      toast('Target box must be different from current box.'); return;
    }
    if (S.boxes[target]) {
      toast('Box ' + target + ' is already occupied. Pick an empty box.');
      $('#bm-n').focus(); return;
    }

    try {
      var moved = await window.CrabApi.moveBox(from, target);
      delete S.boxes[from];
      S.boxes[target] = moved;
      $('#bmove-modal').hidden = true;
      closeBoxSheet();
      renderAll();
      toast('Crab moved from Box ' + from + ' to Box ' + target + '. Box ' + from + ' is now empty.');
    } catch (err) {
      toast('Could not move crab: ' + err.message);
    }
  }

  /* ---------- 2. INVENTORY TAB ---------- */
  var RC = { rows: [] };
  var MV = { list: [], inputs: {}, bn: {} };
  var crabEditId = null, crabDelArmed = false, crabSexPicker = null;

  /* ---------- Reusable Table Pager ---------- */
  function buildPager(pagerEl, infoEl, total, page, pageSize, onPageChange, onPageSizeChange) {
    if (!pagerEl) return;
    pagerEl.textContent = '';
    if (infoEl) infoEl.textContent = '';
    if (total === 0) return;

    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    var start = (page - 1) * pageSize;
    var rangeStart = start + 1;
    var rangeEnd = Math.min(start + pageSize, total);

    if (infoEl) {
      infoEl.textContent = 'Showing ' + rangeStart + '–' + rangeEnd + ' of ' + total;
    }

    if (totalPages <= 1 && (!onPageSizeChange || total <= 10)) return;

    function mkBtn(label, targetPage, isCurrent, disabled) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = label;
      if (isCurrent) btn.setAttribute('aria-current', 'page');
      if (disabled) btn.disabled = true;
      if (!disabled && !isCurrent) {
        btn.addEventListener('click', function () { onPageChange(targetPage); });
      }
      return btn;
    }

    pagerEl.appendChild(mkBtn('‹ Prev', page - 1, false, page <= 1));

    var pages = [];
    if (totalPages <= 7) {
      for (var i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages = [1];
      if (page > 3) pages.push('…');
      for (var j = Math.max(2, page - 1); j <= Math.min(totalPages - 1, page + 1); j++) pages.push(j);
      if (page < totalPages - 2) pages.push('…');
      pages.push(totalPages);
    }

    pages.forEach(function (p) {
      if (p === '…') {
        var sep = document.createElement('span');
        sep.textContent = '…';
        sep.style.cssText = 'padding:0 4px;color:var(--muted);align-self:center';
        pagerEl.appendChild(sep);
      } else {
        pagerEl.appendChild(mkBtn(String(p), p, p === page, false));
      }
    });

    pagerEl.appendChild(mkBtn('Next ›', page + 1, false, page >= totalPages));

    if (onPageSizeChange) {
      var sep2 = document.createElement('span');
      sep2.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)';
      sep2.textContent = 'Rows:';
      var sel = document.createElement('select');
      sel.style.cssText = 'font-size:13px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--surface)';
      [10, 20, 50, 100].forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        if (n === pageSize) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () {
        onPageSizeChange(parseInt(this.value, 10));
      });
      sep2.appendChild(sel);
      pagerEl.appendChild(sep2);
    }
  }

  function renderInventoryStats() {
    var list = S.inventory || [];
    var stock = list.filter(function (c) { return c.status === 'stock'; });
    var moved = list.length - stock.length;
    var gSum = 0, costSum = 0, costCount = 0;

    stock.forEach(function (c) {
      gSum += (c.weight_g || 0);
      if (typeof c.price === 'number') {
        costSum += c.price;
        costCount++;
      }
    });

    var n = stock.length;
    strip('#i-stats', [
      ['Crabs in stock', n, ''],
      ['Total weight', n ? (gSum / 1000).toFixed(2) : '–', n ? 'kg' : ''],
      ['Avg weight', n ? fmtKg(gSum / n) : '–', n ? 'kg' : ''],
      ['Stock cost', costCount ? fmtMoney(costSum) : '–', ''],
      ['Empty boxes', emptyBoxNumbers().length, '']
    ]);

    // Chips
    var chipsHost = $('#i-chips'); chipsHost.textContent = '';
    [
      ['stock', 'In stock', n],
      ['moved', 'Moved', moved],
      ['all', 'All', list.length]
    ].forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip';
      btn.setAttribute('aria-pressed', S.iFilter === d[0] ? 'true' : 'false');
      btn.appendChild(document.createTextNode(d[1]));
      var c = document.createElement('span'); c.className = 'c'; c.textContent = d[2];
      btn.appendChild(c);
      btn.addEventListener('click', function () {
        S.iFilter = d[0];
        renderInventoryTable();
      });
      chipsHost.appendChild(btn);
    });
  }

  function getVisibleInventory() {
    var f = S.iFilter;
    return (S.inventory || []).filter(function (c) {
      if (f === 'stock') return c.status === 'stock';
      if (f === 'moved') return c.status === 'moved';
      return true;
    });
  }

  function updateInventoryActions() {
    var vis = getVisibleInventory();
    var selCount = vis.filter(function (c) { return S.iSel[c.id]; }).length;
    var totalSel = Object.keys(S.iSel).length;

    var stockSelCount = vis.filter(function (c) { return S.iSel[c.id] && c.status === 'stock'; }).length;
    var btnMove = $('#btn-move');
    if (btnMove) {
      btnMove.disabled = (stockSelCount === 0);
      btnMove.textContent = stockSelCount ? 'Move to boxes (' + stockSelCount + ')' : 'Move to boxes';
    }

    var btnDel = $('#btn-del-selected-inv');
    if (btnDel) {
      btnDel.style.display = (S.iSubTab === 'crabs' && totalSel > 0) ? '' : 'none';
      btnDel.textContent = 'Delete selected (' + totalSel + ')';
    }

    var tickAll = $('#i-all');
    if (tickAll) {
      tickAll.checked = vis.length > 0 && selCount === vis.length;
      tickAll.indeterminate = selCount > 0 && selCount < vis.length;
    }
  }

  function selectAllVisibleInventory(checked) {
    var vis = getVisibleInventory();
    if (checked) {
      vis.forEach(function (c) { S.iSel[c.id] = true; });
    } else {
      vis.forEach(function (c) { delete S.iSel[c.id]; });
    }
    renderInventoryTable();
  }

  function renderInventoryTable() {
    renderInventoryStats();
    renderDeliveriesTable();

    var curSub = S.iSubTab || 'crabs';
    var crabsCount = (S.inventory || []).length;
    var delivCount = (S.deliveries || []).length;
    if ($('#i-crabs-cnt')) $('#i-crabs-cnt').textContent = crabsCount;
    if ($('#i-deliv-cnt')) $('#i-deliv-cnt').textContent = delivCount;

    if ($('#btn-isub-crabs')) $('#btn-isub-crabs').setAttribute('aria-pressed', curSub === 'crabs' ? 'true' : 'false');
    if ($('#btn-isub-deliv')) $('#btn-isub-deliv').setAttribute('aria-pressed', curSub === 'deliv' ? 'true' : 'false');

    if ($('#i-page-crabs')) $('#i-page-crabs').hidden = (curSub !== 'crabs');
    if ($('#i-page-deliv')) $('#i-page-deliv').hidden = (curSub !== 'deliv');

    // Controls visibility based on active subpage
    if ($('#btn-move')) $('#btn-move').style.display = (curSub === 'crabs') ? '' : 'none';
    if ($('#exp-inv')) $('#exp-inv').textContent = (curSub === 'deliv') ? 'Export Deliveries CSV' : 'Export Crabs CSV';

    var vis = getVisibleInventory();
    var total = vis.length;
    var pageSize = S.invPageSize || 20;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (S.invPage < 1) S.invPage = 1;
    if (S.invPage > totalPages) S.invPage = totalPages;

    var page = S.invPage;
    var start = (page - 1) * pageSize;
    var pageRows = vis.slice(start, start + pageSize);

    var host = $('#i-body'); host.textContent = '';

    $('#i-hint').textContent = (S.inventory.length === 0)
      ? 'No crabs in inventory. Tap Receive crabs when a delivery arrives from a seller.'
      : (vis.length === 0 ? 'No crabs match this filter.' : '');
    $('#i-wrap').hidden = (vis.length === 0);

    function td(text, cls) {
      var cell = document.createElement('td');
      if (cls) cell.className = cls;
      cell.textContent = text;
      return cell;
    }

    pageRows.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.className = 'clickable-row' + (S.iSel[c.id] ? ' selected' : '');
      var tdTick = document.createElement('td');

      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'tick';
      cb.checked = !!S.iSel[c.id];
      cb.setAttribute('aria-label', 'Select crab ' + c.batch_no);
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (cb.checked) S.iSel[c.id] = true;
        else delete S.iSel[c.id];
        tr.classList.toggle('selected', !!S.iSel[c.id]);
        updateInventoryActions();
      });
      tdTick.appendChild(cb);
      tr.appendChild(tdTick);

      tr.addEventListener('click', function (e) {
        if (e.target.closest('button, input, a')) return;
        if (S.iSel[c.id]) delete S.iSel[c.id];
        else S.iSel[c.id] = true;
        cb.checked = !!S.iSel[c.id];
        tr.classList.toggle('selected', !!S.iSel[c.id]);
        updateInventoryActions();
      });

      var tdBatch = document.createElement('td');
      if (c.status === 'stock') {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'rowbtn';
        btn.textContent = c.batch_no;
        btn.addEventListener('click', function () { openEditCrabModal(c.id); });
        tdBatch.appendChild(btn);
      } else {
        tdBatch.textContent = c.batch_no;
      }
      tr.appendChild(tdBatch);

      tr.appendChild(td(c.seller || ''));
      tr.appendChild(td(fmtKg(c.weight_g), 'r'));
      tr.appendChild(td(typeof c.price === 'number' ? fmtMoney(c.price) : '–', 'r'));

      var tdSex = document.createElement('td');
      tdSex.appendChild(sexTag(c.sex));
      tr.appendChild(tdSex);

      tr.appendChild(td(fmtDate(c.date || c.moved_date)));
      tr.appendChild(td(c.status === 'stock' ? 'In stock' : '→ Box ' + c.moved_to_box));

      // Action column (Delete crab)
      var tdAct = document.createElement('td');
      tdAct.style.textAlign = 'center';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn danger ghost small';
      delBtn.style.padding = '2px 8px';
      delBtn.style.fontSize = '12px';
      delBtn.textContent = 'Delete';
      delBtn.title = 'Delete crab ' + c.batch_no;
      delBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete crab ' + c.batch_no + ' from inventory?')) return;
        try {
          await window.CrabApi.removeInventoryCrab(c.id);
          delete S.iSel[c.id];
          await loadData();
          renderInventoryTable();
          toast('Crab ' + c.batch_no + ' deleted');
        } catch (err) {
          toast(err.message);
        }
      });
      tdAct.appendChild(delBtn);
      tr.appendChild(tdAct);

      host.appendChild(tr);
    });

    updateInventoryActions();

    // Pager for Inventory Crabs
    buildPager(
      $('#i-crabs-pager'),
      $('#i-crabs-info'),
      total,
      page,
      pageSize,
      function (newPage) {
        S.invPage = newPage;
        renderInventoryTable();
      },
      function (newSize) {
        S.invPageSize = newSize;
        S.invPage = 1;
        renderInventoryTable();
      }
    );
  }

  function renderDeliveriesTable() {
    var dels = (S.deliveries || []).slice(); // already latest-first
    var total = dels.length;
    var pageSize = S.delivPageSize || 20;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (S.delivPage < 1) S.delivPage = 1;
    if (S.delivPage > totalPages) S.delivPage = totalPages;

    var page = S.delivPage;
    var start = (page - 1) * pageSize;
    var pageRows = dels.slice(start, start + pageSize);

    if ($('#i-deliv-wrap')) $('#i-deliv-wrap').hidden = (total === 0);
    if ($('#i-deliv-hint')) $('#i-deliv-hint').hidden = (total > 0);
    var host = $('#i-deliv'); host.textContent = '';

    function td(text, cls) {
      var cell = document.createElement('td');
      if (cls) cell.className = cls;
      cell.textContent = text;
      return cell;
    }

    pageRows.forEach(function (d) {
      // aggregate from inventory
      var crabsInDel = (S.inventory || []).filter(function (c) { return c.delivery_id === d.id; });
      var wSum = 0, costSum = 0, inStock = 0, moved = 0, hasCost = false;
      crabsInDel.forEach(function (c) {
        wSum += (c.weight_g || 0);
        if (typeof c.price === 'number') { costSum += c.price; hasCost = true; }
        if (c.status === 'stock') inStock++; else moved++;
      });

      var tr = document.createElement('tr');
      tr.appendChild(td(fmtDate(d.received_date)));
      tr.appendChild(td(d.seller || ''));
      tr.appendChild(td(String(crabsInDel.length), 'r'));
      tr.appendChild(td(fmtKg(wSum), 'r'));
      tr.appendChild(td(hasCost ? fmtMoney(costSum) : '–', 'r'));
      tr.appendChild(td(String(inStock), 'r'));
      tr.appendChild(td(String(moved), 'r'));

      // Action column (Delete delivery)
      var tdAct = document.createElement('td');
      tdAct.style.textAlign = 'center';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn danger ghost small';
      delBtn.style.padding = '2px 8px';
      delBtn.style.fontSize = '12px';
      delBtn.textContent = 'Delete';
      delBtn.title = 'Delete delivery from ' + (d.seller || 'seller');
      delBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var msg = 'Are you sure you want to delete delivery from ' + (d.seller || 'seller') + ' on ' + fmtDate(d.received_date) + '?';
        if (crabsInDel.length > 0) {
          msg += '\n\nThis will remove ' + crabsInDel.length + ' associated crab(s).';
        }
        if (!confirm(msg)) return;
        try {
          await window.CrabApi.removeDelivery(d.id);
          await loadData();
          renderInventoryTable();
          toast('Delivery deleted');
        } catch (err) {
          toast(err.message);
        }
      });
      tdAct.appendChild(delBtn);
      tr.appendChild(tdAct);

      host.appendChild(tr);
    });

    // Pager for Deliveries
    buildPager(
      $('#i-deliv-pager'),
      $('#i-deliv-info'),
      total,
      page,
      pageSize,
      function (newPage) {
        S.delivPage = newPage;
        renderDeliveriesTable();
      },
      function (newSize) {
        S.delivPageSize = newSize;
        S.delivPage = 1;
        renderDeliveriesTable();
      }
    );
  }

  /* Receive Crabs Modal */
  function syncReceiveRows(count) {
    if (RC.rows.length > count) {
      RC.rows.length = count;
      return;
    }
    var usedMap = usedBatchNumbers();
    RC.rows.forEach(function (r) { if (r.bn) usedMap[r.bn.trim().toLowerCase()] = 1; });
    var needed = count - RC.rows.length;
    var suggested = nextBatchNumbers(needed, usedMap);

    suggested.forEach(function (v) {
      RC.rows.push({ bn: v, g: '', price: '', sex: '' });
    });
  }

  function calcReceiveLive() {
    var sumG = 0, countG = 0, costSum = 0, countCost = 0;
    RC.rows.forEach(function (r) {
      var g = kgToG(r.g);
      if (g !== null && g > 0) { sumG += g; countG++; }
      var p = num(r.price);
      if (p !== null && p >= 0) { costSum += p; countCost++; }
    });

    var parts = [];
    if (countG > 0) {
      parts.push(countG + ' of ' + RC.rows.length + ' weighed · total ' + fmtKg(sumG) + ' kg · average ' + fmtKg(sumG / countG) + ' kg');
    }
    if (countCost > 0) {
      parts.push('total cost ' + fmtMoney(costSum));
    }
    $('#rc-calc').textContent = parts.join(' · ');
  }

  function renderReceiveCards() {
    var host = $('#rc-rows'); host.textContent = '';
    RC.rows.forEach(function (r, i) {
      var card = document.createElement('div'); card.className = 'rcard';
      var title = document.createElement('h4'); title.textContent = 'Crab ' + (i + 1);
      card.appendChild(title);

      var g3 = document.createElement('div'); g3.className = 'g3';

      // Batch no.
      var fBn = document.createElement('div'); fBn.className = 'field';
      var lBn = document.createElement('label'); lBn.className = 'lbl'; lBn.textContent = 'Batch no.';
      var inBn = document.createElement('input'); inBn.type = 'text'; inBn.maxLength = 20; inBn.value = r.bn;
      inBn.addEventListener('input', function () { r.bn = inBn.value; });
      fBn.appendChild(lBn); fBn.appendChild(inBn); g3.appendChild(fBn);

      // Weight (kg)
      var fW = document.createElement('div'); fW.className = 'field';
      var lW = document.createElement('label'); lW.className = 'lbl'; lW.textContent = 'Weight (kg)';
      var inW = document.createElement('input'); inW.type = 'number'; inW.inputMode = 'decimal'; inW.min = '0'; inW.step = '0.001'; inW.value = r.g;
      inW.placeholder = 'e.g. 0.085';
      inW.addEventListener('input', function () { r.g = inW.value; calcReceiveLive(); });
      fW.appendChild(lW); fW.appendChild(inW); g3.appendChild(fW);

      // Price (Rs)
      var fP = document.createElement('div'); fP.className = 'field';
      var lP = document.createElement('label'); lP.className = 'lbl'; lP.textContent = 'Price (₹)';
      var inP = document.createElement('input'); inP.type = 'number'; inP.inputMode = 'decimal'; inP.min = '0'; inP.step = '1'; inP.value = r.price;
      inP.addEventListener('input', function () { r.price = inP.value; calcReceiveLive(); });
      fP.appendChild(lP); fP.appendChild(inP); g3.appendChild(fP);

      card.appendChild(g3);

      // Large Male / Female Buttons
      var sexHost = document.createElement('div');
      setupSexPicker(sexHost, r.sex, function (val) { r.sex = val; });
      card.appendChild(sexHost);

      host.appendChild(card);
    });

    calcReceiveLive();
  }

  function openReceiveModal() {
    // populate seller suggestions
    var dl = $('#rc-sellers'); dl.textContent = '';
    var sellers = {};
    (S.deliveries || []).forEach(function (d) { if (d.seller) sellers[d.seller] = 1; });
    Object.keys(sellers).forEach(function (s) {
      var opt = document.createElement('option'); opt.value = s; dl.appendChild(opt);
    });

    $('#rc-seller').value = '';
    $('#rc-date').value = today();
    $('#rc-count').value = 10;
    $('#rc-priceall').value = '';
    populateSpeciesDropdown($('#rc-species'), S.species[0]);

    RC.rows = [];
    syncReceiveRows(10);
    renderReceiveCards();

    $('#receive-modal').hidden = false;
    $('#rc-seller').focus();
  }

  async function saveReceiveCrabs() {
    if (S.saving) return;
    var seller = $('#rc-seller').value.trim();
    var rDate = $('#rc-date').value;
    var species = $('#rc-species').value;

    if (!seller) { toast('Enter the seller name.'); $('#rc-seller').focus(); return; }
    if (!rDate) { toast('Pick the received date.'); $('#rc-date').focus(); return; }

    var usedMap = usedBatchNumbers();
    var seenInDelivery = {};

    for (var i = 0; i < RC.rows.length; i++) {
      var r = RC.rows[i];
      var bn = (r.bn || '').trim();
      var k = bn.toLowerCase();
      if (!bn) { toast('Enter batch number for crab ' + (i + 1)); return; }
      if (seenInDelivery[k]) { toast('Batch number ' + bn + ' is repeated in this delivery.'); return; }
      seenInDelivery[k] = 1;
      if (usedMap[k]) { toast('Batch number ' + bn + ' is already used in ' + usedMap[k] + '.'); return; }

      var g = kgToG(r.g);
      if (g === null || g <= 0) { toast('Enter valid weight for crab ' + (i + 1)); return; }
      var p = num(r.price);
      if (p !== null && p < 0) { toast('Price cannot be negative for crab ' + (i + 1)); return; }
    }

    var crabsPayload = RC.rows.map(function (r) {
      return {
        batch_no: r.bn.trim(),
        weight_g: kgToG(r.g),
        price: r.price !== '' ? parseFloat(r.price) : null,
        sex: r.sex || null,
        species: species
      };
    });

    S.saving = true;
    $('#rc-save').disabled = true;

    try {
      var res = await window.CrabApi.receiveCrabs(seller, rDate, species, crabsPayload);
      if (res.delivery) S.deliveries.unshift(res.delivery);
      if (res.crabs) S.inventory = res.crabs.concat(S.inventory);

      $('#receive-modal').hidden = true;
      renderAll();
      toast(crabsPayload.length + (crabsPayload.length === 1 ? ' crab' : ' crabs') + ' added to inventory');
    } catch (err) {
      toast('Could not save inventory: ' + err.message);
    } finally {
      S.saving = false;
      $('#rc-save').disabled = false;
    }
  }

  /* Edit Crab Modal */
  function openEditCrabModal(id) {
    var c = (S.inventory || []).find(function (x) { return x.id === id; });
    if (!c || c.status === 'moved') return;
    crabEditId = id;
    crabDelArmed = false;

    $('#cr-title').textContent = 'Crab ' + c.batch_no;
    $('#cr-sub').textContent = (c.seller || '') + ' · ' + fmtDate(c.date);
    $('#cr-bn').value = c.batch_no || '';
    $('#cr-g').value = toKg(c.weight_g);
    $('#cr-price').value = typeof c.price === 'number' ? c.price : '';
    crabSexPicker.set(c.sex || '');
    populateSpeciesDropdown($('#cr-species'), c.species);
    $('#cr-notes').value = c.notes || '';
    $('#cr-del').textContent = 'Remove from inventory';

    $('#crab-modal').hidden = false;
    $('#cr-g').focus();
  }

  async function saveEditCrab() {
    var c = (S.inventory || []).find(function (x) { return x.id === crabEditId; });
    if (!c) { $('#crab-modal').hidden = true; return; }

    var bn = $('#cr-bn').value.trim();
    var g = kgToG($('#cr-g').value);
    var p = $('#cr-price').value !== '' ? parseFloat($('#cr-price').value) : null;
    var used = usedBatchNumbers(c.id);

    if (!bn) { toast('Enter batch number.'); $('#cr-bn').focus(); return; }
    if (used[bn.toLowerCase()]) { toast('Batch number ' + bn + ' is already in use in ' + used[bn.toLowerCase()] + '.'); return; }
    if (g === null || g <= 0) { toast('Enter valid weight in kg.'); $('#cr-g').focus(); return; }
    if (p !== null && p < 0) { toast('Price cannot be negative.'); $('#cr-price').focus(); return; }

    var patch = {
      batch_no: bn,
      weight_g: g,
      price: p,
      sex: crabSexPicker.get(),
      species: $('#cr-species').value,
      notes: $('#cr-notes').value.trim()
    };

    try {
      var updated = await window.CrabApi.updateInventoryCrab(c.id, patch);
      var idx = S.inventory.findIndex(function (x) { return x.id === c.id; });
      if (idx !== -1) S.inventory[idx] = updated;
      $('#crab-modal').hidden = true;
      renderAll();
      toast('Crab saved');
    } catch (err) {
      toast('Could not save crab: ' + err.message);
    }
  }

  async function deleteCrab() {
    if (!crabDelArmed) {
      crabDelArmed = true;
      $('#cr-del').textContent = 'Tap again to remove';
      setTimeout(function () {
        if (crabDelArmed) { crabDelArmed = false; $('#cr-del').textContent = 'Remove from inventory'; }
      }, 4000);
      return;
    }

    try {
      await window.CrabApi.removeInventoryCrab(crabEditId);
      S.inventory = S.inventory.filter(function (x) { return x.id !== crabEditId; });
      delete S.iSel[crabEditId];
      $('#crab-modal').hidden = true;
      renderAll();
      toast('Crab removed from inventory');
    } catch (err) {
      toast('Could not remove crab: ' + err.message);
    }
  }

  /* Move to Boxes Modal */
  function openMoveToBoxesModal() {
    var selCrabs = (S.inventory || []).filter(function (c) {
      return c.status === 'stock' && S.iSel[c.id];
    });
    if (!selCrabs.length) return;

    MV.list = selCrabs;
    MV.inputs = {};
    var freeBoxes = emptyBoxNumbers();

    var host = $('#mv-rows'); host.textContent = '';
    selCrabs.forEach(function (c, i) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.textContent = c.batch_no; tr.appendChild(td1);
      var td2 = document.createElement('td'); td2.className = 'r'; td2.textContent = fmtKg(c.weight_g); tr.appendChild(td2);

      var td3 = document.createElement('td');
      var inp = document.createElement('input');
      inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '1'; inp.max = '500'; inp.step = '1';
      inp.value = freeBoxes[i] || '';
      inp.style.minWidth = '75px';
      inp.setAttribute('aria-label', 'Box number for ' + c.batch_no);
      td3.appendChild(inp);
      tr.appendChild(td3);

      MV.inputs[c.id] = inp;
      host.appendChild(tr);
    });

    $('#mv-date').value = today();
    var freeCount = freeBoxes.length;
    $('#mv-calc').textContent = selCrabs.length + (selCrabs.length === 1 ? ' crab' : ' crabs') + ' selected · ' +
      freeCount + ' empty ' + (freeCount === 1 ? 'box' : 'boxes') + ' available';

    $('#move-modal').hidden = false;
  }

  async function saveMoveToBoxes() {
    var date = $('#mv-date').value;
    if (!date) { toast('Pick the stocking date.'); $('#mv-date').focus(); return; }

    var assignments = [];
    var seenBoxes = {};

    for (var i = 0; i < MV.list.length; i++) {
      var c = MV.list[i];
      var inp = MV.inputs[c.id];
      var bNo = parseInt(inp.value, 10);
      if (isNaN(bNo) || bNo < 1 || bNo > 500) {
        toast('Box number for ' + c.batch_no + ' must be 1 to 500.');
        inp.focus(); return;
      }
      if (S.boxes[bNo]) {
        toast('Box ' + bNo + ' is already occupied. Pick an empty box.');
        inp.focus(); return;
      }
      if (seenBoxes[bNo]) {
        toast('Box ' + bNo + ' is assigned more than once.');
        inp.focus(); return;
      }
      seenBoxes[bNo] = 1;
      assignments.push({ crab_id: c.id, box_no: bNo });
    }

    try {
      var res = await window.CrabApi.moveToBoxes(date, assignments);
      // Reload boxes & inventory
      await loadData();
      S.iSel = {};
      $('#move-modal').hidden = true;
      renderAll();
      toast('Moved ' + assignments.length + (assignments.length === 1 ? ' crab' : ' crabs') + ' to boxes');
    } catch (err) {
      toast('Could not move crabs: ' + err.message);
    }
  }

  /* ---------- 3. HARVEST TAB ---------- */
  function renderHarvestStats() {
    var list = S.harvests || [];
    var totalCrabs = 0, totalG = 0, totalRev = 0, daySum = 0, dayCount = 0;

    list.forEach(function (h) {
      var items = h.items || [];
      totalCrabs += items.length || 1;
      totalG += (h.total_weight_g || 0);
      if (h.price_per_kg) {
        totalRev += (h.total_weight_g / 1000) * h.price_per_kg;
      }
      items.forEach(function (i) {
        if (i.stock_date) {
          daySum += Math.max(0, dayDiff(i.stock_date, h.harvest_date));
          dayCount++;
        }
      });
    });

    var readyBoxes = 0, deadBoxes = 0;
    Object.keys(S.boxes).forEach(function (k) {
      var b = S.boxes[k];
      if (!b) return;
      if (b.status === 'harvest') readyBoxes++;
      else if (b.status === 'dead') deadBoxes++;
    });

    var survivalTot = totalCrabs + readyBoxes + deadBoxes;
    var survivalPct = survivalTot > 0 ? Math.round(((totalCrabs + readyBoxes) / survivalTot) * 100) : '–';

    strip('#h-stats', [
      ['Crabs harvested', totalCrabs, ''],
      ['Total weight', list.length ? (totalG / 1000).toFixed(2) : '–', list.length ? 'kg' : ''],
      ['Revenue', list.length ? fmtMoney(totalRev) : '–', ''],
      ['Avg weight', totalCrabs ? fmtKg(totalG / totalCrabs) : '–', totalCrabs ? 'kg' : ''],
      ['Avg days in box', dayCount ? Math.round(daySum / dayCount) : '–', dayCount ? 'days' : ''],
      ['Boxes in Harvest', readyBoxes, ''],
      ['Survival', survivalPct, survivalPct !== '–' ? '%' : '']
    ]);
  }

  function updateHarvestActions() {
    var allLots = S.harvests || [];
    var totalSel = Object.keys(S.hSelLots).length;
    var btnDelH = $('#btn-del-selected-harvest');
    if (btnDelH) {
      btnDelH.style.display = (S.hSubTab === 'lots' && totalSel > 0) ? '' : 'none';
      btnDelH.textContent = 'Delete selected (' + totalSel + ')';
    }

    var tickAll = $('#h-all');
    if (tickAll) {
      var pageSize = S.harvestPageSize || 20;
      var page = S.harvestPage || 1;
      var start = (page - 1) * pageSize;
      var pageLots = allLots.slice(start, start + pageSize);
      var pageSelCount = pageLots.filter(function (h) { return S.hSelLots[h.id]; }).length;
      tickAll.checked = pageLots.length > 0 && pageSelCount === pageLots.length;
      tickAll.indeterminate = pageSelCount > 0 && pageSelCount < pageLots.length;
    }
  }

  function renderHarvestTable() {
    renderHarvestStats();
    renderProfitTable();

    var curSub = S.hSubTab || 'lots';

    // Update subtab chips and counts
    var allLots = (S.harvests || []).slice();
    var lotsCount = allLots.length;
    var profitCount = (S.profits || []).length;
    if ($('#h-lots-cnt')) $('#h-lots-cnt').textContent = lotsCount;
    if ($('#h-profit-cnt')) $('#h-profit-cnt').textContent = profitCount;

    if ($('#btn-hsub-lots')) $('#btn-hsub-lots').setAttribute('aria-pressed', curSub === 'lots' ? 'true' : 'false');
    if ($('#btn-hsub-profit')) $('#btn-hsub-profit').setAttribute('aria-pressed', curSub === 'profit' ? 'true' : 'false');

    // Toggle subpage containers
    if ($('#h-page-lots')) $('#h-page-lots').hidden = (curSub !== 'lots');
    if ($('#h-page-profit')) $('#h-page-profit').hidden = (curSub !== 'profit');

    // Controls visibility based on active subpage
    if ($('#btn-log-harvest')) $('#btn-log-harvest').style.display = (curSub === 'lots') ? '' : 'none';
    if ($('#exp-harvest')) $('#exp-harvest').textContent = (curSub === 'profit') ? 'Export Profit CSV' : 'Export Lots CSV';

    var total = lotsCount;
    var pageSize = S.harvestPageSize || 20;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (S.harvestPage < 1) S.harvestPage = 1;
    if (S.harvestPage > totalPages) S.harvestPage = totalPages;

    var page = S.harvestPage;
    var start = (page - 1) * pageSize;
    var pageLots = allLots.slice(start, start + pageSize);

    $('#h-hint').textContent = (lotsCount === 0)
      ? 'No harvests logged yet. Put a box in Harvest status, then tap Log harvest.'
      : '';
    $('#h-wrap').hidden = (lotsCount === 0);

    var body = $('#h-body'); body.textContent = '';
    var foot = $('#h-foot'); foot.textContent = '';

    function td(text, cls) {
      var cell = document.createElement('td');
      if (cls) cell.className = cls;
      cell.textContent = text;
      return cell;
    }

    var totCrabs = 0, totG = 0, totRev = 0;
    pageLots.forEach(function (h) {
      var tr = document.createElement('tr');
      tr.className = 'clickable-row' + (S.hSelLots[h.id] ? ' selected' : '');

      // Checkbox cell
      var tdTick = document.createElement('td');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'tick';
      cb.checked = !!S.hSelLots[h.id];
      cb.setAttribute('aria-label', 'Select harvest lot ' + fmtDate(h.harvest_date));
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (cb.checked) S.hSelLots[h.id] = true;
        else delete S.hSelLots[h.id];
        tr.classList.toggle('selected', !!S.hSelLots[h.id]);
        updateHarvestActions();
      });
      tdTick.appendChild(cb);
      tr.appendChild(tdTick);

      tr.addEventListener('click', function (e) {
        if (e.target.closest('button, input, a')) return;
        if (S.hSelLots[h.id]) delete S.hSelLots[h.id];
        else S.hSelLots[h.id] = true;
        cb.checked = !!S.hSelLots[h.id];
        tr.classList.toggle('selected', !!S.hSelLots[h.id]);
        updateHarvestActions();
      });

      var tdDate = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'rowbtn';
      btn.textContent = fmtDate(h.harvest_date);
      btn.addEventListener('click', function () { openHarvestModal(h.id); });
      tdDate.appendChild(btn);
      tr.appendChild(tdDate);

      var boxNums = (h.items || []).map(function (i) { return i.box_no; }).sort(function (a, b) { return a - b; });
      tr.appendChild(td(boxNums.length ? boxNums.join(', ') : '–'));
      tr.appendChild(td(fmtKg(h.total_weight_g), 'r'));
      tr.appendChild(td(h.size || '–'));
      tr.appendChild(td(h.price_per_kg ? String(h.price_per_kg) : '–', 'r'));

      var rev = h.price_per_kg ? (h.total_weight_g / 1000) * h.price_per_kg : 0;
      tr.appendChild(td(h.price_per_kg ? fmtMoney(rev) : '–', 'r'));
      tr.appendChild(td(h.buyer || ''));

      var nFiles = h.files ? h.files.length : 0;
      tr.appendChild(td(nFiles ? nFiles + (nFiles === 1 ? ' file' : ' files') : '–'));

      // Action cell (Delete single harvest)
      var tdAct = document.createElement('td');
      tdAct.style.textAlign = 'center';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn danger ghost small';
      delBtn.style.padding = '2px 8px';
      delBtn.style.fontSize = '12px';
      delBtn.textContent = 'Delete';
      delBtn.title = 'Delete harvest lot';
      delBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this harvest lot from ' + fmtDate(h.harvest_date) + '?')) return;
        try {
          await window.CrabApi.deleteHarvest(h.id);
          delete S.hSelLots[h.id];
          await loadData();
          renderHarvestTable();
          toast('Harvest lot deleted');
        } catch (err) {
          toast(err.message);
        }
      });
      tdAct.appendChild(delBtn);
      tr.appendChild(tdAct);

      body.appendChild(tr);

      totCrabs += (h.items ? h.items.length : 1);
      totG += h.total_weight_g;
      totRev += rev;
    });

    if (pageLots.length > 0) {
      var fTr = document.createElement('tr');
      fTr.appendChild(td('')); // for checkbox column
      fTr.appendChild(td('Page Total'));
      fTr.appendChild(td(totCrabs + (totCrabs === 1 ? ' crab' : ' crabs')));
      fTr.appendChild(td(fmtKg(totG), 'r'));
      fTr.appendChild(td(''));
      fTr.appendChild(td('', 'r'));
      fTr.appendChild(td(fmtMoney(totRev), 'r'));
      fTr.appendChild(td(''));
      fTr.appendChild(td(''));
      fTr.appendChild(td('')); // for action column
      foot.appendChild(fTr);
    }

    updateHarvestActions();

    // Pager for Harvest Lots
    buildPager(
      $('#h-lots-pager'),
      null,
      total,
      page,
      pageSize,
      function (newPage) {
        S.harvestPage = newPage;
        renderHarvestTable();
      },
      function (newSize) {
        S.harvestPageSize = newSize;
        S.harvestPage = 1;
        renderHarvestTable();
      }
    );
  }

  function renderProfitTable() {
    var allRows = (S.profits || []).slice(); // already latest-first from API
    var total = allRows.length;
    if ($('#h-profit-cnt')) $('#h-profit-cnt').textContent = total;
    var pageSize = S.profitPageSize;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    // clamp page
    if (S.profitPage < 1) S.profitPage = 1;
    if (S.profitPage > totalPages) S.profitPage = totalPages;

    var page = S.profitPage;
    var start = (page - 1) * pageSize;
    var rows = allRows.slice(start, start + pageSize);

    $('#h-profit-wrap').hidden = (total === 0);
    if ($('#h-profit-hint')) $('#h-profit-hint').hidden = (total > 0);
    var body = $('#h-profit'); body.textContent = '';
    var foot = $('#h-pfoot'); foot.textContent = '';

    function td(text, cls) {
      var cell = document.createElement('td');
      if (cls) cell.className = cls;
      cell.textContent = text;
      return cell;
    }

    // Page rows
    var tc = 0, ts = 0, tp = 0, countP = 0;
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(td(r.batch_no));
      tr.appendChild(td(fmtDate(r.harvest_date)));
      tr.appendChild(td(String(r.box_no)));
      tr.appendChild(td(fmtKg(r.final_weight_g), 'r'));
      tr.appendChild(td(r.buying_price !== null ? fmtMoney(r.buying_price) : '–', 'r'));
      tr.appendChild(td(r.selling_price !== null ? fmtMoney(r.selling_price) : '–', 'r'));

      var pCell = td(r.profit !== null ? (r.profit < 0 ? '-' : '') + fmtMoney(Math.abs(r.profit)) : '–', 'r');
      if (r.profit !== null) {
        pCell.style.color = (r.profit >= 0) ? 'var(--good)' : 'var(--accent)';
        pCell.style.fontWeight = '600';
        tc += (r.buying_price || 0);
        ts += (r.selling_price || 0);
        tp += r.profit;
        countP++;
      }
      tr.appendChild(pCell);
      body.appendChild(tr);
    });

    // Totals footer (page totals)
    if (countP > 0) {
      var f = document.createElement('tr');
      f.appendChild(td('Page total'));
      f.appendChild(td('')); f.appendChild(td('')); f.appendChild(td(''));
      f.appendChild(td(fmtMoney(tc), 'r'));
      f.appendChild(td(fmtMoney(ts), 'r'));
      var totP = td((tp < 0 ? '-' : '') + fmtMoney(Math.abs(tp)), 'r');
      totP.style.color = tp >= 0 ? 'var(--good)' : 'var(--accent)';
      f.appendChild(totP);
      foot.appendChild(f);
    }

    // ---- Pager ----
    var pager = $('#h-profit-pager');
    pager.textContent = '';
    if (total === 0) return;

    // Info label
    var infoEl = document.getElementById('h-profit-info');
    if (infoEl) {
      var rangeStart = start + 1;
      var rangeEnd = Math.min(start + pageSize, total);
      infoEl.textContent = 'Showing ' + rangeStart + '–' + rangeEnd + ' of ' + total;
    }

    if (totalPages <= 1) return;

    function mkBtn(label, targetPage, isCurrent, disabled) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = label;
      if (isCurrent) btn.setAttribute('aria-current', 'page');
      if (disabled) btn.disabled = true;
      if (!disabled && !isCurrent) {
        btn.addEventListener('click', function () {
          S.profitPage = targetPage;
          renderProfitTable();
        });
      }
      return btn;
    }

    // Prev button
    pager.appendChild(mkBtn('‹ Prev', page - 1, false, page === 1));

    // Page number buttons — show up to 7, with ellipsis
    var pages = [];
    if (totalPages <= 7) {
      for (var i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages = [1];
      if (page > 3) pages.push('…');
      for (var j = Math.max(2, page - 1); j <= Math.min(totalPages - 1, page + 1); j++) pages.push(j);
      if (page < totalPages - 2) pages.push('…');
      pages.push(totalPages);
    }

    pages.forEach(function (p) {
      if (p === '…') {
        var sep = document.createElement('span');
        sep.textContent = '…';
        sep.style.cssText = 'padding:0 4px;color:var(--muted);align-self:center';
        pager.appendChild(sep);
      } else {
        pager.appendChild(mkBtn(String(p), p, p === page, false));
      }
    });

    // Next button
    pager.appendChild(mkBtn('Next ›', page + 1, false, page === totalPages));

    // Rows-per-page selector
    var sep2 = document.createElement('span');
    sep2.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)';
    sep2.textContent = 'Rows:';
    var sel = document.createElement('select');
    sel.style.cssText = 'font-size:13px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--surface)';
    [10, 20, 50, 100].forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      if (n === S.profitPageSize) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      S.profitPageSize = parseInt(this.value, 10);
      S.profitPage = 1;
      renderProfitTable();
    });
    sep2.appendChild(sel);
    pager.appendChild(sep2);
  }

  function getEligibleHarvestBoxes() {
    var out = [];
    Object.keys(S.boxes).forEach(function (k) {
      var b = S.boxes[k];
      if (b && b.status === 'harvest') out.push(b);
    });
    return out.sort(function (a, b) { return a.box_no - b.box_no; });
  }

  function renderHarvestBoxPicker() {
    var host = $('#h-boxes'); host.textContent = '';
    var isEdit = !!S.hEditId;
    var h = isEdit ? S.harvests.find(function (x) { return x.id === S.hEditId; }) : null;

    $('#h-boxes-lbl').textContent = isEdit ? 'Boxes in this harvest' : 'Boxes in Harvest status';
    $('#h-pick-actions').hidden = isEdit;

    if (isEdit) {
      var items = (h && h.items) ? h.items : [];
      if (!items.length) {
        var em = document.createElement('div'); em.className = 'log-empty'; em.textContent = 'No boxes linked to this harvest';
        host.appendChild(em); return;
      }
      items.forEach(function (it) {
        var c = document.createElement('div'); c.className = 'pk static';
        var a = document.createElement('b'); a.textContent = 'Box ' + it.box_no;
        var s = document.createElement('span'); s.textContent = (it.size || '') + ' · ' + fmtKg(it.final_weight_g) + ' kg';
        c.appendChild(a); c.appendChild(s); host.appendChild(c);
      });
      return;
    }

    var eligible = getEligibleHarvestBoxes();
    if (!eligible.length) {
      var em2 = document.createElement('div'); em2.className = 'log-empty';
      em2.textContent = 'No boxes are currently in Harvest status. Set boxes to Harvest on the Boxes tab first.';
      host.appendChild(em2); return;
    }

    eligible.forEach(function (b) {
      var on = !!S.hSel[b.box_no];
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'pk';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');

      var title = document.createElement('b');
      title.textContent = (on ? '✓ ' : '') + 'Box ' + b.box_no;
      var sub = document.createElement('span');
      sub.textContent = (b.size || 'No size') + ' · ' + fmtKg(deriveBox(b).cur) + ' kg';

      btn.appendChild(title); btn.appendChild(sub);
      btn.addEventListener('click', function () {
        if (S.hSel[b.box_no]) delete S.hSel[b.box_no];
        else S.hSel[b.box_no] = true;
        renderHarvestBoxPicker();
        syncHarvestWeightLive();
      });
      host.appendChild(btn);
    });
  }

  function syncHarvestWeightLive() {
    if (!S.hEditId && !S.hWTouched) {
      var eligible = getEligibleHarvestBoxes();
      var sum = 0;
      eligible.forEach(function (b) {
        if (S.hSel[b.box_no]) sum += deriveBox(b).cur;
      });
      $('#h-g').value = sum > 0 ? toKg(sum) : '';
    }
    calcHarvestLive();
  }

  function calcHarvestLive() {
    var g = kgToG($('#h-g').value);
    var p = num($('#h-price').value);
    var selBoxes = Object.keys(S.hSel).length;

    var parts = [];
    if (!S.hEditId && selBoxes > 0) {
      $('#h-info').textContent = selBoxes + (selBoxes === 1 ? ' box selected. It will be emptied when you save.' : ' boxes selected. They will be emptied when you save.');
    } else {
      $('#h-info').textContent = '';
    }

    if (selBoxes > 0 && g) {
      parts.push(fmtKg(g / selBoxes) + ' kg per crab');
    }
    if (g && p !== null) {
      parts.push('Revenue ' + fmtMoney((g / 1000) * p));
    }
    $('#h-calc').textContent = parts.join(' · ');
  }

  function renderHarvestFiles() {
    var host = $('#h-files'); host.textContent = '';
    var files = S.hFiles || [];
    if (!files.length) {
      var em = document.createElement('div'); em.className = 'muted'; em.style.fontSize = '14px';
      em.textContent = 'No documents attached.';
      host.appendChild(em); return;
    }

    files.forEach(function (f, idx) {
      var r = document.createElement('div'); r.className = 'frow';
      var a = document.createElement('a'); a.href = f.file_url || '#'; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = f.file_name;
      var sz = document.createElement('span'); sz.className = 'sz';
      sz.textContent = f.size_bytes ? (f.size_bytes < 1048576 ? Math.round(f.size_bytes / 1024) + ' KB' : (f.size_bytes / 1048576).toFixed(1) + ' MB') : '';
      r.appendChild(a); r.appendChild(sz);

      var xBtn = document.createElement('button'); xBtn.type = 'button'; xBtn.className = 'x'; xBtn.textContent = '×';
      xBtn.setAttribute('aria-label', 'Remove document');
      xBtn.addEventListener('click', async function () {
        if (f.id && S.hEditId) {
          try {
            await window.CrabApi.removeHarvestFile(S.hEditId, f.id);
            toast('Document removed');
          } catch (e) {}
        }
        S.hFiles.splice(idx, 1);
        renderHarvestFiles();
      });
      r.appendChild(xBtn);
      host.appendChild(r);
    });
  }

  function openHarvestModal(id) {
    S.hEditId = id || null;
    S.hDelArmed = false;
    S.hSel = {};
    S.hWTouched = !!id;

    var h = id ? S.harvests.find(function (x) { return x.id === id; }) : null;

    $('#h-title').textContent = h ? 'Edit harvest' : 'Log harvest';
    $('#h-date').value = h ? h.harvest_date : today();
    $('#h-grade').value = h ? h.size : '';
    $('#h-g').value = h ? toKg(h.total_weight_g) : '';
    $('#h-price').value = h && h.price_per_kg ? h.price_per_kg : '';
    $('#h-buyer').value = h ? h.buyer || '' : '';
    $('#h-notes').value = h ? h.notes || '' : '';
    $('#h-del').hidden = !h;
    $('#h-del').textContent = 'Delete';

    S.hFiles = h && h.files ? JSON.parse(JSON.stringify(h.files)) : [];
    renderHarvestFiles();
    renderHarvestBoxPicker();
    calcHarvestLive();

    $('#harvest-modal').hidden = false;
  }

  async function saveHarvest() {
    if (S.saving) return;
    var date = $('#h-date').value;
    var size = $('#h-grade').value;
    var g = kgToG($('#h-g').value);
    var p = num($('#h-price').value);
    var buyer = $('#h-buyer').value.trim();
    var notes = $('#h-notes').value.trim();

    if (!size) { toast('Select the crab size.'); $('#h-grade').focus(); return; }
    if (!date) { toast('Pick the harvest date.'); $('#h-date').focus(); return; }
    if (g === null || g <= 0) { toast('Enter the total weight in kg.'); $('#h-g').focus(); return; }
    if (p !== null && p < 0) { toast('Price per kg cannot be negative.'); $('#h-price').focus(); return; }

    var isEdit = !!S.hEditId;
    var selBoxes = Object.keys(S.hSel).map(Number);

    if (!isEdit && !selBoxes.length) {
      toast('Select at least one box in Harvest status.'); return;
    }

    S.saving = true;
    $('#h-save').disabled = true;

    try {
      if (isEdit) {
        await window.CrabApi.updateHarvest(S.hEditId, {
          harvest_date: date,
          size: size,
          total_weight_g: g,
          price_per_kg: p,
          buyer: buyer,
          notes: notes
        });
        toast('Harvest updated');
      } else {
        await window.CrabApi.createHarvest({
          harvest_date: date,
          size: size,
          total_weight_g: g,
          price_per_kg: p,
          buyer: buyer,
          notes: notes
        }, selBoxes);
        toast('Harvest logged. Selected boxes are now empty.');
      }
      await loadData();
      $('#harvest-modal').hidden = true;
      renderAll();
    } catch (err) {
      toast('Could not save harvest: ' + err.message);
    } finally {
      S.saving = false;
      $('#h-save').disabled = false;
    }
  }

  async function deleteHarvest() {
    if (!S.hDelArmed) {
      S.hDelArmed = true;
      $('#h-del').textContent = 'Tap again to delete';
      setTimeout(function () {
        if (S.hDelArmed) { S.hDelArmed = false; $('#h-del').textContent = 'Delete'; }
      }, 4000);
      return;
    }

    try {
      await window.CrabApi.deleteHarvest(S.hEditId);
      await loadData();
      $('#harvest-modal').hidden = true;
      renderAll();
      toast('Harvest deleted');
    } catch (err) {
      toast('Could not delete harvest: ' + err.message);
    }
  }

  /* ---------- 4. MONITOR TAB ---------- */
  function tBad(v) { return v !== null && v !== undefined && (v < S.settings.temp_min || v > S.settings.temp_max); }
  function pBad(v) { return v !== null && v !== undefined && (v < S.settings.ph_min || v > S.settings.ph_max); }

  function groupReadingsBySensor() {
    var out = {};
    (S.readings || []).forEach(function (r) {
      var loc = r.source || 'Tank sensor';
      var ms = new Date(r.recorded_at).getTime();
      if (!isFinite(ms)) return;
      (out[loc] = out[loc] || []).push({
        t: ms,
        temp: r.temperature_c,
        ph: r.ph
      });
    });
    Object.keys(out).forEach(function (k) {
      out[k].sort(function (a, b) { return a.t - b.t; });
    });
    return out;
  }

  function checkMonitorAlertState(sensorMap) {
    var bad = false;
    Object.keys(sensorMap).forEach(function (loc) {
      var pts = sensorMap[loc];
      if (pts.length) {
        var last = pts[pts.length - 1];
        if (tBad(last.temp) || pBad(last.ph)) bad = true;
      }
    });
    return bad;
  }

  function renderMonitor() {
    var all = groupReadingsBySensor();
    var locs = Object.keys(all).sort();

    // Alert dot on Monitor tab
    var hasAlert = checkMonitorAlertState(all);
    $('#mon-dot').hidden = !hasAlert;

    if (S.tab !== 'monitor') return;

    // Range chips
    var hostChips = $('#range-chips'); hostChips.textContent = '';
    RANGES.forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip'; btn.textContent = r[0];
      btn.setAttribute('aria-pressed', S.range === r[1] ? 'true' : 'false');
      btn.addEventListener('click', function () {
        S.range = r[1];
        renderMonitor();
      });
      hostChips.appendChild(btn);
    });

    $('#t-range').textContent = 'Safe ' + S.settings.temp_min + '–' + S.settings.temp_max + ' °C';
    $('#p-range').textContent = 'Safe ' + S.settings.ph_min + '–' + S.settings.ph_max;

    var sHost = $('#sensors'); sHost.textContent = '';
    locs.forEach(function (loc) {
      var pts = all[loc];
      var last = pts[pts.length - 1];
      var c = document.createElement('div'); c.className = 'sensor';
      var h = document.createElement('div'); h.className = 'sh';
      var nm = document.createElement('b'); nm.textContent = loc;
      var tm = document.createElement('span'); tm.textContent = fmtAgo(last.t);
      h.appendChild(nm); h.appendChild(tm); c.appendChild(h);

      var vals = document.createElement('div'); vals.className = 'vals';

      function valBox(label, val, unit, isBad, lo, hi) {
        var v = document.createElement('div');
        v.className = 'val' + (val !== null ? (isBad ? ' bad' : '') : ' none');
        var k = document.createElement('div'); k.className = 'k'; k.textContent = label;
        var numEl = document.createElement('div'); numEl.className = 'v';
        numEl.textContent = val !== null ? String(Number(val.toFixed(2))) : '–';
        if (val !== null && unit) {
          var u = document.createElement('small'); u.textContent = unit; numEl.appendChild(u);
        }
        var s = document.createElement('div'); s.className = 's';
        s.textContent = (val !== null) ? (isBad ? (val < lo ? 'Too low' : 'Too high') : 'In range') : 'No data';
        v.appendChild(k); v.appendChild(numEl); v.appendChild(s);
        vals.appendChild(v);
      }

      valBox('Temperature', last.temp, '°C', tBad(last.temp), S.settings.temp_min, S.settings.temp_max);
      valBox('pH', last.ph, '', pBad(last.ph), S.settings.ph_min, S.settings.ph_max);

      c.appendChild(vals);
      sHost.appendChild(c);
    });

    var t1 = Date.now(), t0 = t1 - S.range;
    drawChart($('#chart-temp'), $('#legend-temp'), all, locs, 'temp', t0, t1, S.settings.temp_min, S.settings.temp_max, '°C');
    drawChart($('#chart-ph'), $('#legend-ph'), all, locs, 'ph', t0, t1, S.settings.ph_min, S.settings.ph_max, '');

    // Out of range alerts
    var alerts = [];
    locs.forEach(function (loc) {
      all[loc].forEach(function (p) {
        if (p.t < t0) return;
        if (tBad(p.temp)) alerts.push({ t: p.t, loc: loc, msg: 'Temperature ' + p.temp + ' °C (' + (p.temp < S.settings.temp_min ? 'below ' + S.settings.temp_min : 'above ' + S.settings.temp_max) + ')' });
        if (pBad(p.ph)) alerts.push({ t: p.t, loc: loc, msg: 'pH ' + p.ph + ' (' + (p.ph < S.settings.ph_min ? 'below ' + S.settings.ph_min : 'above ' + S.settings.ph_max) + ')' });
      });
    });
    alerts.sort(function (a, b) { return b.t - a.t; });

    var alertBody = $('#alerts'); alertBody.textContent = '';
    if (!alerts.length) {
      var tr0 = document.createElement('tr'); var td0 = document.createElement('td');
      td0.className = 'muted'; td0.textContent = locs.length ? 'Nothing out of range in this period.' : 'No readings yet.';
      tr0.appendChild(td0); alertBody.appendChild(tr0);
    } else {
      alerts.slice(0, 15).forEach(function (al) {
        var tr = document.createElement('tr');
        [fmtDT(al.t), al.loc, al.msg].forEach(function (txt) {
          var td = document.createElement('td'); td.textContent = txt; tr.appendChild(td);
        });
        alertBody.appendChild(tr);
      });
    }
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function drawChart(host, legend, all, locs, key, t0, t1, bMin, bMax, unit) {
    host.textContent = ''; legend.textContent = '';
    var series = [], vals = [bMin, bMax];

    locs.forEach(function (loc, i) {
      var pts = all[loc].filter(function (p) {
        return p.t >= t0 && p.t <= t1 && p[key] !== null && p[key] !== undefined;
      });
      if (pts.length) {
        series.push({ loc: loc, color: COLORS[i % COLORS.length], pts: pts });
        pts.forEach(function (p) { vals.push(p[key]); });
      }
    });

    if (!series.length) {
      var em = document.createElement('div'); em.className = 'chart-empty';
      em.textContent = 'No readings in this period.';
      host.appendChild(em); return;
    }

    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var step = (hi - lo || 1) / 4;
    var ymin = lo - step * 0.2, ymax = hi + step * 0.2;

    var W = Math.max(260, host.clientWidth || 600), H = 220;
    var m = { l: 42, r: 12, t: 10, b: 26 };
    var X = function (t) { return m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r); };
    var Y = function (v) { return m.t + (1 - (v - ymin) / (ymax - ymin)) * (H - m.t - m.b); };

    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    // Safe range band
    var yTop = Y(bMax), yBottom = Y(bMin);
    svg.appendChild(svgEl('rect', {
      class: 'band', x: m.l, y: yTop, width: W - m.l - m.r, height: Math.max(0, yBottom - yTop)
    }));

    // Time ticks
    for (var i = 0; i <= 4; i++) {
      var tt = t0 + (t1 - t0) * i / 4;
      var d = new Date(tt);
      var lab = S.range <= 864e5 ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      var xt = svgEl('text', { x: X(tt), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' });
      xt.textContent = lab; svg.appendChild(xt);
    }

    // Series lines and points
    series.forEach(function (s) {
      var dStr = s.pts.map(function (p, j) {
        return (j ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p[key]).toFixed(1);
      }).join(' ');
      if (s.pts.length > 1) {
        svg.appendChild(svgEl('path', { d: dStr, fill: 'none', stroke: s.color, 'stroke-width': 2 }));
      }
      s.pts.forEach(function (p, j) {
        var bad = (key === 'temp' ? tBad(p.temp) : pBad(p.ph));
        svg.appendChild(svgEl('circle', {
          cx: X(p.t), cy: Y(p[key]), r: 3,
          fill: bad ? '#C8361F' : s.color,
          stroke: '#FFFFFF', 'stroke-width': 1
        }));
      });

      var legSpan = document.createElement('span');
      var legDot = document.createElement('i'); legDot.style.background = s.color;
      legSpan.appendChild(legDot); legSpan.appendChild(document.createTextNode(s.loc));
      legend.appendChild(legSpan);
    });

    var safeLegend = document.createElement('span'); safeLegend.className = 'muted';
    safeLegend.textContent = 'Green band = safe range';
    legend.appendChild(safeLegend);

    host.appendChild(svg);
  }

  /* Reading Modals */
  function openReadingModal() {
    var dl = $('#r-locs'); dl.textContent = '';
    var locs = Object.keys(groupReadingsBySensor());
    locs.forEach(function (l) { var opt = document.createElement('option'); opt.value = l; dl.appendChild(opt); });

    $('#r-loc').value = locs[0] || 'Tank 1';
    $('#r-time').value = nowLocalInput();
    $('#r-temp').value = '';
    $('#r-ph').value = '';
    $('#reading-modal').hidden = false;
    $('#r-temp').focus();
  }

  async function saveReading() {
    var loc = $('#r-loc').value.trim();
    var time = $('#r-time').value;
    var temp = $('#r-temp').value !== '' ? parseFloat($('#r-temp').value) : null;
    var ph = $('#r-ph').value !== '' ? parseFloat($('#r-ph').value) : null;

    if (!loc) { toast('Enter sensor or location name.'); $('#r-loc').focus(); return; }
    if (!time) { toast('Pick time.'); return; }
    if (temp === null && ph === null) { toast('Enter temperature or pH.'); return; }
    if (ph !== null && (ph < 0 || ph > 14)) { toast('pH must be between 0 and 14.'); return; }

    try {
      await window.CrabApi.addReading({
        time: new Date(time).toISOString(),
        temp: temp,
        ph: ph,
        source: loc
      });
      await loadData();
      $('#reading-modal').hidden = true;
      renderAll();
      toast('Reading recorded');
    } catch (err) {
      toast('Could not save reading: ' + err.message);
    }
  }

  /* CSV Import for Readings */
  function parseCsvText(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) return [];
    var header = lines[0].split(',').map(function (h) { return h.trim().toLowerCase(); });

    var iT = header.indexOf('time'); if (iT === -1) iT = header.indexOf('date');
    var iS = header.indexOf('sensor'); if (iS === -1) iS = header.indexOf('source');
    var iTemp = header.indexOf('temp');
    var iPh = header.indexOf('ph');

    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(',').map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
      var t = cols[iT] || new Date().toISOString();
      var s = (iS !== -1 && cols[iS]) ? cols[iS] : 'Imported';
      var temp = (iTemp !== -1 && cols[iTemp]) ? parseFloat(cols[iTemp]) : null;
      var ph = (iPh !== -1 && cols[iPh]) ? parseFloat(cols[iPh]) : null;
      if (temp !== null || ph !== null) {
        out.push({ time: t, source: s, temp: temp, ph: ph });
      }
    }
    return out;
  }

  /* ---------- 5. SETTINGS & USER MODALS ---------- */
  function openSettingsModal() {
    $('#s-farm').value = S.settings.farm_name || '';
    $('#s-count').value = S.settings.box_count || 40;
    $('#s-tmin').value = S.settings.temp_min !== undefined ? S.settings.temp_min : 26;
    $('#s-tmax').value = S.settings.temp_max !== undefined ? S.settings.temp_max : 32;
    $('#s-pmin').value = S.settings.ph_min !== undefined ? S.settings.ph_min : 7.5;
    $('#s-pmax').value = S.settings.ph_max !== undefined ? S.settings.ph_max : 8.5;
    $('#settings').hidden = false;
    $('#s-count').focus();
  }

  async function saveSettings() {
    var count = parseInt($('#s-count').value, 10);
    if (isNaN(count) || count < 1 || count > 500) {
      toast('Enter box count from 1 to 500.');
      $('#s-count').focus(); return;
    }

    var tmin = num($('#s-tmin').value);
    var tmax = num($('#s-tmax').value);
    var pmin = num($('#s-pmin').value);
    var pmax = num($('#s-pmax').value);

    if (tmin === null || tmax === null || tmin >= tmax) {
      toast('Temp min must be below max.'); return;
    }
    if (pmin === null || pmax === null || pmin >= pmax) {
      toast('pH min must be below max.'); return;
    }

    try {
      var updated = await window.CrabApi.updateSettings({
        farm_name: $('#s-farm').value.trim(),
        box_count: count,
        temp_min: tmin,
        temp_max: tmax,
        ph_min: pmin,
        ph_max: pmax
      });
      S.settings = updated;
      $('#settings').hidden = true;
      renderAll();
      toast('Settings saved');
    } catch (err) {
      toast('Could not save settings: ' + err.message);
    }
  }

  function handleLogout() {
    window.CrabApi.logout();
    showLoginView();
    toast('Signed out successfully');
  }

  function showLoginView() {
    $('#view-login').hidden = false;
    $('#main-app').hidden = true;
    $('#otp-step-request').hidden = false;
    $('#otp-step-verify').hidden = true;
    $('#dev-otp-box').hidden = true;
    $('#new-user-box').hidden = true;
    $('#l-otp').value = '';
  }

  async function showMainApp() {
    $('#view-login').hidden = true;
    $('#main-app').hidden = false;
    renderAll();
    await loadData();
    renderAll();
    route();
  }

  /* ---------- CSV Export Client Trigger ---------- */
  function triggerExport(type) {
    window.location.href = '/api/export/' + type;
  }

  /* ---------- Global Routing and Render ---------- */
  function renderAll() {
    renderHeader();
    renderBoxesGrid();
    renderInventoryTable();
    renderHarvestTable();
    renderMonitor();
  }

  function route() {
    var h = location.hash.replace('#', '');
    S.tab = (TABS.indexOf(h) >= 0) ? h : 'boxes'; // Defaults to Boxes!

    TABS.forEach(function (t) {
      var view = $('#view-' + t);
      if (view) view.hidden = (t !== S.tab);
    });

    document.querySelectorAll('#tabs a').forEach(function (a) {
      if (a.getAttribute('data-tab') === S.tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (S.tab === 'boxes') renderBoxesGrid();
    else if (S.tab === 'inventory') renderInventoryTable();
    else if (S.tab === 'harvest') renderHarvestTable();
    else if (S.tab === 'monitor') renderMonitor();
  }

  /* ---------- Data Loader ---------- */
  async function loadData() {
    try {
      var [settings, species, boxes, inv, dels, harvests, profits, readings] = await Promise.all([
        window.CrabApi.getSettings().catch(function () { return S.settings; }),
        window.CrabApi.getSpecies().catch(function () { return S.species.map(function (n, i) { return { id: i, name: n }; }); }),
        window.CrabApi.getBoxes().catch(function () { return []; }),
        window.CrabApi.getInventory('all').catch(function () { return []; }),
        window.CrabApi.getDeliveries().catch(function () { return []; }),
        window.CrabApi.getHarvests().catch(function () { return []; }),
        window.CrabApi.getProfit().catch(function () { return []; }),
        window.CrabApi.getReadings().catch(function () { return []; })
      ]);

      if (settings) S.settings = settings;
      if (species && species.length) S.species = species.map(function (s) { return s.name; });

      var bMap = {};
      (boxes || []).forEach(function (b) { bMap[b.box_no] = b; });
      S.boxes = bMap;

      S.inventory = inv || [];
      S.deliveries = dels || [];
      S.harvests = harvests || [];
      S.profits = profits || [];
      S.profitPage = 1; // reset to first page on fresh data load
      S.readings = readings || [];

      window.CrabApi.notifyStatus('synced');
    } catch (err) {
      window.CrabApi.notifyStatus('offline', err.message);
    }
  }

  /* ---------- Event Wiring ---------- */
  function initEvents() {
    // Header actions
    $('#btn-settings').addEventListener('click', openSettingsModal);
    $('#btn-header-logout').addEventListener('click', handleLogout);
    $('#s-cancel').addEventListener('click', function () { $('#settings').hidden = true; });
    $('#s-save').addEventListener('click', saveSettings);

    // --- Login Page Events ---
    var sentOtpData = null;

    $('#tab-auth-phone').addEventListener('click', function () {
      $('#tab-auth-phone').classList.add('active');
      $('#tab-auth-email').classList.remove('active');
      $('#tab-auth-demo').classList.remove('active');
      $('#panel-auth-phone').hidden = false;
      $('#panel-auth-email').hidden = true;
      $('#panel-auth-demo').hidden = true;
    });

    $('#tab-auth-email').addEventListener('click', function () {
      $('#tab-auth-email').classList.add('active');
      $('#tab-auth-phone').classList.remove('active');
      $('#tab-auth-demo').classList.remove('active');
      $('#panel-auth-email').hidden = false;
      $('#panel-auth-phone').hidden = true;
      $('#panel-auth-demo').hidden = true;
    });

    $('#tab-auth-demo').addEventListener('click', function () {
      $('#tab-auth-demo').classList.add('active');
      $('#tab-auth-phone').classList.remove('active');
      $('#tab-auth-email').classList.remove('active');
      $('#panel-auth-demo').hidden = false;
      $('#panel-auth-phone').hidden = true;
      $('#panel-auth-email').hidden = true;
    });

    $('#subtab-email-signin').addEventListener('click', function () {
      $('#subtab-email-signin').classList.add('active');
      $('#subtab-email-signup').classList.remove('active');
      $('#email-signin-form').hidden = false;
      $('#email-signup-form').hidden = true;
    });

    $('#subtab-email-signup').addEventListener('click', function () {
      $('#subtab-email-signup').classList.add('active');
      $('#subtab-email-signin').classList.remove('active');
      $('#email-signup-form').hidden = false;
      $('#email-signin-form').hidden = true;
    });

    async function doSendOtp() {
      var phone = $('#l-phone').value.trim();
      var clean = phone.replace(/\D/g, '');
      if (clean.length < 10) {
        toast('Please enter a valid 10-digit mobile number');
        return;
      }
      $('#btn-send-otp').disabled = true;
      try {
        var res = await window.CrabApi.sendOtp(clean);
        sentOtpData = res;
        $('#disp-phone').textContent = res.phone;
        $('#otp-step-request').hidden = true;
        $('#otp-step-verify').hidden = false;
        $('#new-user-box').hidden = res.exists;

        if (res.dev_otp) {
          $('#dev-otp-val').textContent = res.dev_otp;
          $('#dev-otp-box').hidden = false;
        } else {
          $('#dev-otp-box').hidden = true;
        }

        if (!res.exists) {
          $('#new-phone-name').value = '';
          $('#new-phone-name').focus();
        } else {
          $('#l-otp').focus();
        }
        toast(res.message);
      } catch (err) {
        toast(err.message);
      } finally {
        $('#btn-send-otp').disabled = false;
      }
    }

    $('#btn-send-otp').addEventListener('click', doSendOtp);
    $('#btn-resend-otp').addEventListener('click', doSendOtp);

    $('#btn-change-phone').addEventListener('click', function () {
      $('#otp-step-request').hidden = false;
      $('#otp-step-verify').hidden = true;
      $('#l-phone').focus();
    });

    $('#btn-autofill-otp').addEventListener('click', function () {
      if (sentOtpData && sentOtpData.dev_otp) {
        $('#l-otp').value = sentOtpData.dev_otp;
        toast('Verification code filled');
      }
    });

    $('#btn-verify-otp').addEventListener('click', async function () {
      var phone = sentOtpData ? sentOtpData.phone : $('#l-phone').value.trim();
      var otp = $('#l-otp').value.trim();
      if (!otp || otp.length !== 6) {
        toast('Please enter the 6-digit OTP');
        return;
      }
      var name = '';
      var role = 'staff';
      if (sentOtpData && !sentOtpData.exists) {
        name = $('#new-phone-name').value.trim();
        if (!name) {
          toast('Please enter your full name');
          $('#new-phone-name').focus();
          return;
        }
        role = $('#new-phone-role').value;
      }

      $('#btn-verify-otp').disabled = true;
      try {
        var res = await window.CrabApi.verifyOtp(phone, otp, name, role);
        window.CrabApi.setAuth(res.token, res.user);
        toast((res.created ? 'Account created! Welcome, ' : 'Welcome back, ') + res.user.name);
        await showMainApp();
      } catch (err) {
        toast(err.message);
      } finally {
        $('#btn-verify-otp').disabled = false;
      }
    });

    $('#btn-email-signin').addEventListener('click', async function () {
      var email = $('#em-login-email').value.trim();
      var pass = $('#em-login-pass').value;
      if (!email || !pass) {
        toast('Please enter email/mobile and password');
        return;
      }
      $('#btn-email-signin').disabled = true;
      try {
        var res = await window.CrabApi.login(email, pass);
        window.CrabApi.setAuth(res.token, res.user);
        toast('Signed in as ' + res.user.name);
        await showMainApp();
      } catch (err) {
        toast(err.message);
      } finally {
        $('#btn-email-signin').disabled = false;
      }
    });

    $('#btn-email-signup').addEventListener('click', async function () {
      var name = $('#em-reg-name').value.trim();
      var email = $('#em-reg-email').value.trim();
      var phone = $('#em-reg-phone').value.trim();
      var pass = $('#em-reg-pass').value;
      var role = $('#em-reg-role').value;

      if (!name) { toast('Please enter your full name'); return; }
      if (!email && !phone) { toast('Please enter email or mobile number'); return; }
      if (!pass || pass.length < 4) { toast('Password must be at least 4 characters'); return; }

      $('#btn-email-signup').disabled = true;
      try {
        var res = await window.CrabApi.request('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name: name, email: email, phone: phone, password: pass, role: role })
        });
        window.CrabApi.setAuth(res.token, res.user);
        toast('Account created! Welcome, ' + res.user.name);
        await showMainApp();
      } catch (err) {
        toast(err.message);
      } finally {
        $('#btn-email-signup').disabled = false;
      }
    });

    document.querySelectorAll('.demo-acc-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var email = this.getAttribute('data-email');
        var pass = this.getAttribute('data-pass');
        try {
          var res = await window.CrabApi.login(email, pass);
          window.CrabApi.setAuth(res.token, res.user);
          toast('Signed in as ' + res.user.name);
          await showMainApp();
        } catch (err) {
          toast(err.message);
        }
      });
    });

    // Boxes View
    $('#search').addEventListener('input', function (e) {
      S.q = e.target.value;
      renderBoxesGrid();
    });
    $('#exp-boxes').addEventListener('click', function () { triggerExport('boxes'); });

    // Box Sheet
    $('#sheet-close').addEventListener('click', closeBoxSheet);
    $('#btn-cancel').addEventListener('click', closeBoxSheet);
    $('#scrim').addEventListener('click', closeBoxSheet);
    $('#btn-save').addEventListener('click', saveBox);
    $('#btn-del').addEventListener('click', deleteBox);
    $('#btn-bmove').addEventListener('click', openMoveBoxModal);
    $('#bm-cancel').addEventListener('click', function () { $('#bmove-modal').hidden = true; });
    $('#bm-save').addEventListener('click', saveBoxMove);

    document.querySelectorAll('#seg button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.draftBox.status = btn.getAttribute('data-status');
        setBoxSheetStatusUI();
        if (S.draftBox.status === 'harvest' && !$('#f-size').value) {
          $('#f-size').focus();
        }
      });
    });

    $('#btn-weigh').addEventListener('click', function () {
      var g = kgToG($('#w-g').value);
      var d = $('#w-date').value || today();
      if (!g || g <= 0) { toast('Enter valid weight in kg.'); $('#w-g').focus(); return; }
      S.draftBox.weights.push({ weighed_on: d, weight_g: g });
      $('#w-g').value = '';
      renderBoxGrowthLog();
    });

    $('#btn-moult').addEventListener('click', function () {
      var t = today();
      if (S.draftBox.moults.indexOf(t) === -1) {
        S.draftBox.moults.push(t);
        renderBoxMoults();
      }
    });

    // Inventory View
    $('#btn-isub-crabs').addEventListener('click', function () {
      S.iSubTab = 'crabs';
      renderInventoryTable();
    });
    $('#btn-isub-deliv').addEventListener('click', function () {
      S.iSubTab = 'deliv';
      renderInventoryTable();
    });

    $('#btn-del-selected-inv').addEventListener('click', async function () {
      var ids = Object.keys(S.iSel).filter(function (id) { return S.iSel[id]; });
      if (ids.length === 0) return;
      if (!confirm('Are you sure you want to delete ' + ids.length + ' selected crab(s) from inventory?')) return;

      var deletedCount = 0;
      var failedCount = 0;
      for (var i = 0; i < ids.length; i++) {
        try {
          await window.CrabApi.removeInventoryCrab(parseInt(ids[i], 10));
          deletedCount++;
        } catch (e) {
          failedCount++;
        }
      }
      S.iSel = {};
      await loadData();
      renderInventoryTable();
      if (failedCount > 0) {
        toast('Deleted ' + deletedCount + ' crab(s), ' + failedCount + ' failed.');
      } else {
        toast('Deleted ' + deletedCount + ' crab(s).');
      }
    });

    $('#btn-receive').addEventListener('click', openReceiveModal);
    $('#rc-cancel').addEventListener('click', function () { $('#receive-modal').hidden = true; });
    $('#rc-save').addEventListener('click', saveReceiveCrabs);
    $('#rc-count').addEventListener('input', function () {
      var n = parseInt($('#rc-count').value, 10);
      if (n >= 1 && n <= 100) {
        syncReceiveRows(n);
        renderReceiveCards();
      }
    });
    $('#rc-applyprice').addEventListener('click', function () {
      var p = $('#rc-priceall').value;
      if (p === '') { toast('Enter a price to apply to all.'); return; }
      RC.rows.forEach(function (r) { r.price = p; });
      renderReceiveCards();
    });

    $('#i-all').addEventListener('change', function () {
      selectAllVisibleInventory($('#i-all').checked);
    });
    $('#btn-move').addEventListener('click', openMoveToBoxesModal);
    $('#mv-cancel').addEventListener('click', function () { $('#move-modal').hidden = true; });
    $('#mv-save').addEventListener('click', saveMoveToBoxes);
    $('#exp-inv').addEventListener('click', function () {
      triggerExport(S.iSubTab === 'deliv' ? 'deliveries' : 'inventory');
    });

    // Crab Edit
    $('#cr-cancel').addEventListener('click', function () { $('#crab-modal').hidden = true; });
    $('#cr-save').addEventListener('click', saveEditCrab);
    $('#cr-del').addEventListener('click', deleteCrab);

    // Harvest View
    $('#btn-hsub-lots').addEventListener('click', function () {
      S.hSubTab = 'lots';
      renderHarvestTable();
    });
    $('#btn-hsub-profit').addEventListener('click', function () {
      S.hSubTab = 'profit';
      renderHarvestTable();
    });

    $('#h-all').addEventListener('change', function () {
      var checked = $('#h-all').checked;
      var allLots = S.harvests || [];
      if (checked) {
        allLots.forEach(function (h) { S.hSelLots[h.id] = true; });
      } else {
        S.hSelLots = {};
      }
      renderHarvestTable();
    });

    $('#btn-del-selected-harvest').addEventListener('click', async function () {
      var ids = Object.keys(S.hSelLots).filter(function (id) { return S.hSelLots[id]; });
      if (ids.length === 0) return;
      if (!confirm('Are you sure you want to delete ' + ids.length + ' selected harvest lot(s)?')) return;

      var deletedCount = 0;
      var failedCount = 0;
      for (var i = 0; i < ids.length; i++) {
        try {
          await window.CrabApi.deleteHarvest(parseInt(ids[i], 10));
          deletedCount++;
        } catch (e) {
          failedCount++;
        }
      }
      S.hSelLots = {};
      await loadData();
      renderHarvestTable();
      if (failedCount > 0) {
        toast('Deleted ' + deletedCount + ' harvest lot(s), ' + failedCount + ' failed.');
      } else {
        toast('Deleted ' + deletedCount + ' harvest lot(s).');
      }
    });

    $('#btn-log-harvest').addEventListener('click', function () { openHarvestModal(null); });
    $('#h-cancel').addEventListener('click', function () { $('#harvest-modal').hidden = true; });
    $('#h-save').addEventListener('click', saveHarvest);
    $('#h-del').addEventListener('click', deleteHarvest);
    $('#exp-harvest').addEventListener('click', function () {
      triggerExport(S.hSubTab === 'profit' ? 'profit' : 'harvest');
    });

    $('#h-grade').addEventListener('change', function () {
      if (S.hEditId) return;
      var sz = $('#h-grade').value;
      if (!sz) return;
      S.hSel = {};
      getEligibleHarvestBoxes().forEach(function (b) {
        if (b.size === sz) S.hSel[b.box_no] = true;
      });
      renderHarvestBoxPicker();
      syncHarvestWeightLive();
    });

    $('#h-all').addEventListener('click', function () {
      getEligibleHarvestBoxes().forEach(function (b) { S.hSel[b.box_no] = true; });
      renderHarvestBoxPicker();
      syncHarvestWeightLive();
    });
    $('#h-none').addEventListener('click', function () {
      S.hSel = {};
      renderHarvestBoxPicker();
      syncHarvestWeightLive();
    });

    $('#h-g').addEventListener('input', function () {
      S.hWTouched = true;
      calcHarvestLive();
    });
    $('#h-price').addEventListener('input', calcHarvestLive);

    $('#h-attach').addEventListener('click', function () {
      if (!S.hEditId) {
        toast('Save harvest first to attach files, or attach to existing harvests.');
      }
      $('#h-file').click();
    });

    $('#h-file').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;

      if (file.size > 20 * 1024 * 1024) {
        toast('File is larger than 20 MB.'); return;
      }

      if (S.hEditId) {
        try {
          var res = await window.CrabApi.uploadHarvestFile(S.hEditId, file);
          S.hFiles.push(res);
          renderHarvestFiles();
          toast('Document uploaded');
        } catch (err) {
          toast('Upload failed: ' + err.message);
        }
      } else {
        toast('Please save harvest before uploading document attachments.');
      }
    });

    // Monitor View
    $('#btn-add-reading').addEventListener('click', openReadingModal);
    $('#r-cancel').addEventListener('click', function () { $('#reading-modal').hidden = true; });
    $('#r-save').addEventListener('click', saveReading);
    $('#btn-import').addEventListener('click', function () { $('#file-import').click(); });
    $('#exp-readings').addEventListener('click', function () { triggerExport('readings'); });

    $('#file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;

      var reader = new FileReader();
      reader.onload = async function () {
        var readings = parseCsvText(String(reader.result || ''));
        if (!readings.length) {
          toast('No valid readings found in CSV.'); return;
        }
        try {
          var res = await window.CrabApi.importReadings(readings);
          await loadData();
          renderMonitor();
          toast('Imported ' + res.count + ' readings from CSV');
        } catch (err) {
          toast('Import failed: ' + err.message);
        }
      };
      reader.readAsText(f);
    });

    // Escape Key Handler for all modals
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var modalIds = ['#reading-modal', '#move-modal', '#crab-modal', '#receive-modal', '#harvest-modal', '#settings', '#bmove-modal'];
        for (var i = 0; i < modalIds.length; i++) {
          if (!$(modalIds[i]).hidden) { $(modalIds[i]).hidden = true; return; }
        }
        if (S.openBoxNo !== null) closeBoxSheet();
      }
    });

    // Initialize Sex button pickers for box sheet and crab edit
    boxSexPicker = setupSexPicker($('#f-sex-seg'), '', function (v) {
      if (S.draftBox) S.draftBox.sex = v;
    });
    crabSexPicker = setupSexPicker($('#cr-sex-seg'), '', function (v) {});

    // Listen to API status changes
    window.CrabApi.onStatusChange(function () {
      renderHeader();
    });

    // Routing
    window.addEventListener('hashchange', route);
  }

  // Initial startup
  async function startApp() {
    initEvents();

    if (!window.CrabApi.isLoggedIn()) {
      showLoginView();
    } else {
      await showMainApp();
    }

    // Auto-ping connection every 30s
    setInterval(function () {
      window.CrabApi.checkConnection();
    }, 30000);
  }

  startApp();
})();
