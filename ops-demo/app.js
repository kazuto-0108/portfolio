/* 店舗日報ボード（制作見本）
   日報（売上・客数・勤怠）→ 当日の集計 → 前日比 → 月次の表、までをブラウザの中だけで行う。
   外部のライブラリや通信は使っていない。データはページを読み込み直すと最初の状態に戻る。 */
(() => {
  'use strict';

  // ---------- 設定 ----------
  const STORES = ['渋谷店', '新宿店', '池袋店', '横浜店'];
  const COLORS = ['#3b5bdb', '#0c8599', '#e8590c', '#7048e8'];
  const STAFF = {
    '渋谷店': ['青木', '井上', '上田', '遠藤', '大野', '岡田'],
    '新宿店': ['加藤', '木村', '工藤', '小林', '近藤', '河野'],
    '池袋店': ['斉藤', '清水', '杉山', '関', '佐野', '柴田'],
    '横浜店': ['高橋', '千葉', '土屋', '寺田', '富田', '田村'],
  };
  const FIRST = '2026-11-01';
  const LAST = '2026-11-20';       // ダミーデータの最終日
  const MONTH_END = '2026-11-30';
  const ALERT = -0.10;             // 前日比がこれを下回ると「要確認」
  const WORKDAY_H = 8;             // 1日の労働時間がこれを超えた分を「8時間超」として数える
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  // ---------- 小さな道具 ----------
  const $ = (id) => document.getElementById(id);
  const key = (date, store) => date + '|' + store;
  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const toHM = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  const addDays = (date, n) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
  const label = (date) => Number(date.slice(5, 7)) + '月' + Number(date.slice(8, 10)) + '日（' + WEEK[dow(date)] + '）';
  const yen = (n) => Math.round(n).toLocaleString('ja-JP');
  const hrs = (h) => h.toFixed(1);
  const pct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
  const pctCell = (x) => x === null ? '<span class="muted">—</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + pct(x) + '</span>';
  const div = (a, b) => (b ? a / b : 0);
  const shiftHours = (s) => Math.max(0, (toMin(s.out) - toMin(s.in) - s.brk) / 60);
  const overtime = (h) => Math.max(0, h - WORKDAY_H);

  // ---------- ダミーデータ（毎回同じ内容になるよう、種を固定した乱数で作る） ----------
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seed() {
    const rnd = mulberry32(20261121);
    const base = [190000, 215000, 160000, 125000];
    const ticket = [1900, 2100, 1800, 1850];
    let dayIndex = 0;
    const recs = new Map();
    for (let d = FIRST; d <= LAST; d = addDays(d, 1)) {
      const w = dow(d);
      const weekFactor = (w === 0 || w === 6) ? 1.06 : (w === 5 ? 1.03 : 1);
      STORES.forEach((store, i) => {
        let sales = Math.round(base[i] * weekFactor * (0.97 + rnd() * 0.06) / 1000) * 1000;
        const unit = ticket[i] * (0.96 + rnd() * 0.08);
        // 出勤は6人の持ち回りで毎日3人。3日出勤して3日休む並びになり、週40時間を超えない
        const n = 3;
        const start = (dayIndex + i) % STAFF[store].length;
        const shifts = [];
        for (let k = 0; k < n; k++) {
          const inMin = 9 * 60 + [0, 30, 60][Math.floor(rnd() * 3)];
          const len = [7.5, 8, 8, 8, 8.5, 9][Math.floor(rnd() * 6)];
          shifts.push({ name: STAFF[store][(start + k) % STAFF[store].length], in: toHM(inMin), out: toHM(inMin + len * 60 + 60), brk: 60 });
        }
        // 「要確認」の例: 池袋店の 11/19 を前日より 16% 少なくする
        if (d === '2026-11-19' && store === '池袋店') {
          sales = Math.round(recs.get(key('2026-11-18', store)).sales * 0.84 / 1000) * 1000;
        }
        // 「未提出」の例: 最終日の横浜店は日報を入れない
        if (d === LAST && store === '横浜店') return;
        recs.set(key(d, store), { date: d, store, sales, customers: Math.round(sales / unit), shifts });
      });
      dayIndex++;
    }
    return recs;
  }

  // ---------- 状態 ----------
  const state = { recs: seed(), date: LAST, flash: null };
  const get = (date, store) => state.recs.get(key(date, store)) || null;

  // ---------- 集計 ----------
  /** 1店舗・1日の数値。日報がなければ null */
  function storeDay(date, store) {
    const r = get(date, store);
    if (!r) return null;
    const hours = r.shifts.map(shiftHours);
    const labor = hours.reduce((a, b) => a + b, 0);
    return { sales: r.sales, customers: r.customers, labor, ot: hours.reduce((a, h) => a + overtime(h), 0), shifts: r.shifts };
  }

  /** 当日の集計。全店の前日比は「当日と前日の両方に日報がある店舗」どうしで比べる */
  function daily(date) {
    const prev = addDays(date, -1);
    const rows = STORES.map((store) => {
      const t = storeDay(date, store);
      const y = storeDay(prev, store);
      const cmp = !!(t && y && y.sales > 0);   // 前日の売上が 0（休業など）のときは比べない
      return { store, t, dod: cmp ? t.sales / y.sales - 1 : null, ySales: cmp ? y.sales : 0, cmp };
    });
    const sum = (f) => rows.reduce((a, r) => a + (r.t ? f(r.t) : 0), 0);
    const cmpToday = rows.reduce((a, r) => a + (r.cmp ? r.t.sales : 0), 0);
    const cmpYesterday = rows.reduce((a, r) => a + r.ySales, 0);
    return {
      rows,
      sales: sum((t) => t.sales), customers: sum((t) => t.customers), labor: sum((t) => t.labor),
      dod: cmpYesterday ? cmpToday / cmpYesterday - 1 : null,
      submitted: rows.filter((r) => r.t).length,
    };
  }

  /** 月次の集計（店舗別・スタッフ別・日別） */
  function monthly() {
    const stores = STORES.map((store) => ({ store, days: 0, sales: 0, customers: 0, labor: 0, ot: 0 }));
    const staff = new Map();
    const days = [];
    for (let d = FIRST; d <= MONTH_END; d = addDays(d, 1)) {
      const per = STORES.map((store, i) => {
        const t = storeDay(d, store);
        if (!t) return 0;
        const s = stores[i];
        s.days++; s.sales += t.sales; s.customers += t.customers; s.labor += t.labor; s.ot += t.ot;
        t.shifts.forEach((sh) => {
          const k = store + '|' + sh.name;
          const m = staff.get(k) || { store, name: sh.name, days: 0, labor: 0, ot: 0 };
          const h = shiftHours(sh);
          m.days++; m.labor += h; m.ot += overtime(h);
          staff.set(k, m);
        });
        return t.sales;
      });
      days.push({ date: d, per, total: per.reduce((a, b) => a + b, 0) });
    }
    const staffRows = [];
    STORES.forEach((store) => STAFF[store].forEach((name) => { const m = staff.get(store + '|' + name); if (m) staffRows.push(m); }));
    const total = stores.reduce((a, s) => ({ sales: a.sales + s.sales, customers: a.customers + s.customers, labor: a.labor + s.labor, ot: a.ot + s.ot, days: a.days + s.days }),
      { sales: 0, customers: 0, labor: 0, ot: 0, days: 0 });
    return { stores, staff: staffRows, days, total };
  }

  // ---------- 表示: ① 当日の集計 ----------
  const dot = (i) => '<span class="dot" style="background:' + COLORS[i] + '"></span>';

  function renderDaily() {
    const date = state.date;
    const d = daily(date);
    $('d-date').value = date;
    $('d-prev').disabled = date <= FIRST;
    $('d-next').disabled = date >= MONTH_END;

    const missing = STORES.length - d.submitted;
    $('kpis').innerHTML =
      '<div class="kpi"><span>' + label(date) + ' 全店の売上</span><b>' + yen(d.sales) + '<small>円</small></b><em>前日比 ' + pctCell(d.dod) + '</em></div>' +
      '<div class="kpi"><span>客数</span><b>' + yen(d.customers) + '<small>人</small></b></div>' +
      '<div class="kpi"><span>客単価</span><b>' + yen(div(d.sales, d.customers)) + '<small>円</small></b></div>' +
      '<div class="kpi"><span>人時売上高</span><b>' + yen(div(d.sales, d.labor)) + '<small>円/時間</small></b></div>' +
      '<div class="kpi' + (missing ? ' kpi--warn' : '') + '"><span>日報の提出</span><b>' + d.submitted + '<small>／' + STORES.length + ' 店舗</small></b>' +
      (missing ? '<em class="down">未提出 ' + missing + ' 店舗</em>' : '<em class="up">すべて提出済み</em>') + '</div>';

    const body = d.rows.map((r, i) => {
      const flash = state.flash === key(date, r.store) ? ' class="is-new"' : '';
      if (!r.t) {
        return '<tr><td>' + dot(i) + r.store + '</td><td class="muted" colspan="6" style="text-align:center">日報がまだ届いていません</td><td><span class="tag tag--none">未提出</span></td></tr>';
      }
      const status = r.dod !== null && r.dod < ALERT ? '<span class="tag tag--warn">要確認</span>' : '<span class="tag tag--ok">提出済み</span>';
      return '<tr' + flash + '><td>' + dot(i) + r.store + '</td><td>' + yen(r.t.sales) + '</td><td>' + pctCell(r.dod) + '</td><td>' + yen(r.t.customers) +
        '</td><td>' + yen(div(r.t.sales, r.t.customers)) + '</td><td>' + hrs(r.t.labor) + '</td><td>' + yen(div(r.t.sales, r.t.labor)) + '</td><td>' + status + '</td></tr>';
    }).join('');
    $('t-daily').innerHTML =
      '<thead><tr><th>店舗</th><th>売上（円）</th><th>前日比</th><th>客数（人）</th><th>客単価（円）</th><th>労働時間（時間）</th><th>人時売上高（円）</th><th>状態</th></tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '<tfoot><tr><td>全店</td><td>' + yen(d.sales) + '</td><td>' + pctCell(d.dod) + '</td><td>' + yen(d.customers) + '</td><td>' + yen(div(d.sales, d.customers)) +
      '</td><td>' + hrs(d.labor) + '</td><td>' + yen(div(d.sales, d.labor)) + '</td><td class="muted">' + (missing ? '前日比は提出済みの店舗で比較' : '') + '</td></tr></tfoot>';

    const shiftRows = d.rows.map((r, i) => {
      if (!r.t) return '<tr><td>' + dot(i) + r.store + '</td><td class="muted l" colspan="6">日報なし</td></tr>';
      return r.t.shifts.map((s, k) => {
        const h = shiftHours(s);
        const ot = overtime(h);
        return '<tr><td>' + (k === 0 ? dot(i) + r.store : '') + '</td><td class="l">' + s.name + '</td><td>' + s.in + '</td><td>' + s.out + '</td><td>' + s.brk + '分</td><td>' + hrs(h) +
          '</td><td>' + (ot > 0 ? '<span class="down">' + hrs(ot) + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('');
    }).join('');
    $('t-shifts').innerHTML = '<thead><tr><th>店舗</th><th class="l">スタッフ</th><th>出勤</th><th>退勤</th><th>休憩</th><th>労働時間（時間）</th><th>うち8時間超</th></tr></thead><tbody>' + shiftRows + '</tbody>';
    state.flash = null;
  }

  // ---------- 表示: ② 日報の入力 ----------
  function shiftRow(store, s) {
    const tr = document.createElement('tr');
    const opts = STAFF[store].map((n) => '<option' + (s && s.name === n ? ' selected' : '') + '>' + n + '</option>').join('');
    tr.innerHTML =
      '<td><select aria-label="スタッフ">' + opts + '</select></td>' +
      '<td><input type="time" aria-label="出勤" value="' + (s ? s.in : '09:00') + '" step="300"></td>' +
      '<td><input type="time" aria-label="退勤" value="' + (s ? s.out : '18:00') + '" step="300"></td>' +
      '<td><input type="number" aria-label="休憩（分）" value="' + (s ? s.brk : 60) + '" min="0" step="5" inputmode="numeric"></td>' +
      '<td class="h"></td><td><button type="button" class="del" aria-label="この行を削除">×</button></td>';
    return tr;
  }

  function readShift(tr) {
    const [inEl, outEl, brkEl] = tr.querySelectorAll('input');
    return { name: tr.querySelector('select').value, in: inEl.value, out: outEl.value, brk: brkEl.value.trim() === '' ? NaN : Number(brkEl.value) };
  }

  function updateHours() {
    $('f-shifts').querySelectorAll('tr').forEach((tr) => {
      const s = readShift(tr);
      const ok = s.in && s.out && Number.isFinite(s.brk);
      const h = ok ? shiftHours(s) : 0;
      tr.querySelector('.h').innerHTML = ok ? hrs(h) + ' 時間' + (overtime(h) > 0 ? ' <span class="down">（8時間超 ' + hrs(overtime(h)) + '）</span>' : '') : '—';
    });
  }

  function setShifts(store, shifts) {
    const body = $('f-shifts');
    body.innerHTML = '';
    shifts.forEach((s) => body.appendChild(shiftRow(store, s)));
    updateHours();
  }

  function loadForm() {
    const date = $('f-date').value;
    const store = $('f-store').value;
    const r = date ? get(date, store) : null;
    $('f-msg').textContent = '';
    if (r) {
      $('f-sales').value = r.sales;
      $('f-cust').value = r.customers;
      setShifts(store, r.shifts);
      $('f-state').textContent = '登録済みの日報を読み込みました。登録すると上書きします。';
    } else {
      $('f-sales').value = '';
      $('f-cust').value = '';
      setShifts(store, [null, { name: STAFF[store][1], in: '10:00', out: '19:00', brk: 60 }]);
      $('f-state').textContent = date ? label(date) + ' の ' + store + ' はまだ登録されていません。' : '';
    }
  }

  function fillExample() {
    const store = $('f-store').value;
    const i = STORES.indexOf(store);
    $('f-sales').value = [198000, 221000, 163000, 131000][i];
    $('f-cust').value = [104, 105, 90, 71][i];
    setShifts(store, [
      { name: STAFF[store][0], in: '09:00', out: '18:00', brk: 60 },
      { name: STAFF[store][2], in: '10:00', out: '19:30', brk: 60 },
      { name: STAFF[store][3], in: '12:00', out: '17:00', brk: 0 },
    ]);
    $('f-msg').textContent = '';
  }

  function validate() {
    const date = $('f-date').value;
    const sales = $('f-sales').value.trim();
    const cust = $('f-cust').value.trim();
    if (!date || date < FIRST || date > MONTH_END) return '日付は 2026年11月1日〜30日 の範囲で入力してください。';
    if (!/^\d{1,8}$/.test(sales)) return '売上は 0 以上・8桁までの整数で入力してください。';
    if (!/^\d{1,5}$/.test(cust)) return '客数は 0 以上・5桁までの整数で入力してください。';
    const shifts = Array.from($('f-shifts').querySelectorAll('tr')).map(readShift);
    if (!shifts.length) return '勤怠を1人以上入力してください。';
    const seen = new Set();
    for (const s of shifts) {
      if (!s.in || !s.out) return s.name + ' さんの出勤・退勤の時刻を入力してください。';
      if (!Number.isInteger(s.brk) || s.brk < 0) return s.name + ' さんの休憩は 0 以上の分で入力してください。';
      if (toMin(s.out) - toMin(s.in) - s.brk <= 0) return s.name + ' さんの退勤が出勤より前か、休憩が勤務時間より長くなっています（日をまたぐ勤務には対応していません）。';
      if (seen.has(s.name)) return s.name + ' さんが2行あります。1人1行にまとめてください。';
      seen.add(s.name);
    }
    return { date, store: $('f-store').value, sales: Number(sales), customers: Number(cust), shifts };
  }

  function submit(e) {
    e.preventDefault();
    const v = validate();
    if (typeof v === 'string') { $('f-msg').textContent = v; return; }
    state.recs.set(key(v.date, v.store), v);
    state.date = v.date;
    state.flash = key(v.date, v.store);
    const g = $('guide');
    g.classList.add('is-done');
    g.innerHTML = '<b>登録しました：</b>' + label(v.date) + ' ' + v.store + ' の日報を反映しました。当日の集計と前日比、<button class="link" id="guide-go">③ 月次の表</button>が更新されています。';
    $('guide-go').addEventListener('click', () => show('monthly'));
    loadForm();
    show('daily');
  }

  // ---------- 表示: ③ 月次の表 ----------
  function renderChart(days) {
    let last = 0;
    days.forEach((d, i) => { if (d.date <= LAST || d.total > 0) last = i; });
    const shown = days.slice(0, last + 1);   // 日報のない日も横軸には残す
    const W = 900, H = 250, L = 52, B = 26, T = 10;
    const max = Math.max(...shown.map((d) => d.total), 1);
    const step = max > 2000000 ? Math.ceil(max / 4 / 1000000) * 1000000 : 200000;
    const top = Math.ceil(max / step) * step;
    const bw = (W - L - 8) / shown.length;
    const y = (v) => T + (H - T - B) * (1 - v / top);
    let g = '';
    for (let v = 0; v <= top; v += step) {
      g += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e6eaf0"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="#5b6b82">' + (v / 10000) + '万</text>';
    }
    shown.forEach((d, i) => {
      let acc = 0;
      const x = L + i * bw + bw * 0.14;
      d.per.forEach((v, k) => {
        if (!v) return;
        g += '<rect x="' + x.toFixed(1) + '" y="' + y(acc + v).toFixed(1) + '" width="' + (bw * 0.72).toFixed(1) + '" height="' + (y(acc) - y(acc + v)).toFixed(1) + '" fill="' + COLORS[k] + '">' +
          '<title>' + label(d.date) + ' ' + STORES[k] + ' ' + yen(v) + '円</title></rect>';
        acc += v;
      });
      const w = dow(d.date);
      g += '<text x="' + (x + bw * 0.36).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="' + (w === 0 ? '#c92a2a' : w === 6 ? '#3b5bdb' : '#5b6b82') + '">' + Number(d.date.slice(8)) + '</text>';
    });
    $('m-chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="11月の日ごとの売上を店舗別に積み上げた棒グラフ">' + g + '</svg>' +
      '<div class="legend">' + STORES.map((s, i) => '<span>' + dot(i) + s + '</span>').join('') + '<span class="muted">横軸は日付（青＝土曜、赤＝日曜）</span></div>';
  }

  function renderMonthly() {
    const m = monthly();
    renderChart(m.days);
    const t = m.total;
    $('t-month').innerHTML =
      '<thead><tr><th>店舗</th><th>提出日数</th><th>売上合計（円）</th><th>構成比</th><th>日平均（円）</th><th>客数（人）</th><th>客単価（円）</th><th>労働時間（時間）</th><th>うち8時間超</th><th>人時売上高（円）</th></tr></thead><tbody>' +
      m.stores.map((s, i) => '<tr><td>' + dot(i) + s.store + '</td><td>' + s.days + '</td><td>' + yen(s.sales) + '</td><td>' + (div(s.sales, t.sales) * 100).toFixed(1) + '%</td><td>' + yen(div(s.sales, s.days)) +
        '</td><td>' + yen(s.customers) + '</td><td>' + yen(div(s.sales, s.customers)) + '</td><td>' + hrs(s.labor) + '</td><td>' + hrs(s.ot) + '</td><td>' + yen(div(s.sales, s.labor)) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>全店</td><td>' + t.days + '</td><td>' + yen(t.sales) + '</td><td>100.0%</td><td class="muted">—</td><td>' + yen(t.customers) + '</td><td>' + yen(div(t.sales, t.customers)) +
      '</td><td>' + hrs(t.labor) + '</td><td>' + hrs(t.ot) + '</td><td>' + yen(div(t.sales, t.labor)) + '</td></tr></tfoot>';
    $('t-staff').innerHTML =
      '<thead><tr><th>店舗</th><th class="l">スタッフ</th><th>出勤日数</th><th>労働時間（時間）</th><th>うち8時間超</th><th>1日平均（時間）</th></tr></thead><tbody>' +
      m.staff.map((s) => '<tr><td>' + dot(STORES.indexOf(s.store)) + s.store + '</td><td class="l">' + s.name + '</td><td>' + s.days + '</td><td>' + hrs(s.labor) + '</td><td>' +
        (s.ot > 0 ? hrs(s.ot) : '<span class="muted">—</span>') + '</td><td>' + hrs(div(s.labor, s.days)) + '</td></tr>').join('') + '</tbody>';
  }

  function exportCsv() {
    const m = monthly();
    const lines = [['2026年11月 店舗別の集計'], ['店舗', '提出日数', '売上合計', '客数', '客単価', '労働時間', 'うち8時間超', '人時売上高']];
    m.stores.forEach((s) => lines.push([s.store, s.days, s.sales, s.customers, Math.round(div(s.sales, s.customers)), hrs(s.labor), hrs(s.ot), Math.round(div(s.sales, s.labor))]));
    lines.push([], ['2026年11月 スタッフ別の勤怠'], ['店舗', 'スタッフ', '出勤日数', '労働時間', 'うち8時間超']);
    m.staff.forEach((s) => lines.push([s.store, s.name, s.days, hrs(s.labor), hrs(s.ot)]));
    const csv = '﻿' + lines.map((l) => l.join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = '月次集計_2026-11.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- 画面の切り替え ----------
  const RENDER = { daily: renderDaily, monthly: renderMonthly, input: () => {}, how: () => {} };
  function show(name) {
    Object.keys(RENDER).forEach((n) => {
      $('tab-' + n).setAttribute('aria-selected', String(n === name));
      $('p-' + n).hidden = n !== name;
    });
    RENDER[name]();
    window.scrollTo(0, 0);
  }

  // ---------- 初期化 ----------
  function init() {
    const names = Object.keys(RENDER);
    names.forEach((n, i) => {
      $('tab-' + n).addEventListener('click', () => show(n));
      // 左右の矢印キーでタブを移動できるようにする
      $('tab-' + n).addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        const next = names[(i + step + names.length) % names.length];
        show(next);
        $('tab-' + next).focus();
      });
    });
    $('guide-go').addEventListener('click', () => show('input'));

    ['d-date', 'f-date'].forEach((id) => { $(id).min = FIRST; $(id).max = MONTH_END; });
    $('d-date').addEventListener('change', (e) => { if (e.target.value >= FIRST && e.target.value <= MONTH_END) state.date = e.target.value; renderDaily(); });
    $('d-prev').addEventListener('click', () => { state.date = addDays(state.date, -1); renderDaily(); });
    $('d-next').addEventListener('click', () => { state.date = addDays(state.date, 1); renderDaily(); });

    $('f-store').innerHTML = STORES.map((s) => '<option>' + s + '</option>').join('');
    $('f-store').value = '横浜店';
    $('f-date').value = LAST;
    $('f-date').addEventListener('change', loadForm);
    $('f-store').addEventListener('change', loadForm);
    $('f-add').addEventListener('click', () => {
      const store = $('f-store').value;
      const used = Array.from($('f-shifts').querySelectorAll('select')).map((s) => s.value);
      const next = STAFF[store].find((n) => !used.includes(n)) || STAFF[store][0];
      $('f-shifts').appendChild(shiftRow(store, { name: next, in: '09:00', out: '18:00', brk: 60 }));
      updateHours();
    });
    $('f-shifts').addEventListener('input', updateHours);
    $('f-shifts').addEventListener('click', (e) => { if (e.target.classList.contains('del')) { e.target.closest('tr').remove(); } });
    $('f-fill').addEventListener('click', fillExample);
    $('form').addEventListener('submit', submit);
    $('m-csv').addEventListener('click', exportCsv);

    loadForm();
    renderDaily();
  }

  init();
})();
