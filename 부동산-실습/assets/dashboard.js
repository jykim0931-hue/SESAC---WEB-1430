// 서울 아파트 매매 시장 대시보드 — 데이터 로드 + 렌더링
// 차트 라이브러리 없이 인라인 SVG로 직접 그린다. (PRD §8, dataviz 스킬 준수)

const SVGNS = 'http://www.w3.org/2000/svg';
const AREA_BANDS = ['소형', '중소형', '중형', '대형'];

/* ---------------- formatting helpers ---------------- */

function fmtWon(v) {
  if (v == null) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(Math.round(v));
  const eok = Math.floor(a / 10000);
  const man = a % 10000;
  if (eok > 0 && man > 0) return `${sign}${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만원`;
  if (eok > 0) return `${sign}${eok.toLocaleString('ko-KR')}억원`;
  return `${sign}${man.toLocaleString('ko-KR')}만원`;
}

function fmtPyeong(v) {
  if (v == null) return '—';
  return `${Math.round(v).toLocaleString('ko-KR')}만원`;
}

function fmtPct(v, digits = 1) {
  if (v == null) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

function fmtCount(v) {
  if (v == null) return '—';
  return `${v.toLocaleString('ko-KR')}건`;
}

function fmtEok(manwon) {
  return `${(manwon / 10000).toFixed(1)}억`;
}

function deltaClass(v) {
  if (v == null) return 'delta-flat';
  if (v > 0) return 'delta-up';
  if (v < 0) return 'delta-down';
  return 'delta-flat';
}

/* ---------------- DOM helpers ---------------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v; // only used for trusted static fragments below
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ---------------- tooltip (shared singleton) ---------------- */

const tooltipEl = document.getElementById('viz-tooltip');

function showTooltip(clientX, clientY, title, rows) {
  clear(tooltipEl);
  tooltipEl.appendChild(el('div', { className: 'tt-title', textContent: title }));
  for (const [k, v] of rows) {
    tooltipEl.appendChild(el('div', { className: 'tt-row' }, [
      el('span', { textContent: k }),
      el('span', { className: 'tt-val', textContent: v }),
    ]));
  }
  const pad = 12;
  const x = Math.min(Math.max(clientX, 90), window.innerWidth - 90);
  const y = Math.max(clientY, 70);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y - pad}px`;
  tooltipEl.classList.add('visible');
}

function hideTooltip() {
  tooltipEl.classList.remove('visible');
}

function attachHover(hitEl, onEnter) {
  // onEnter(clientX, clientY) -> void; hover + keyboard focus both supported.
  hitEl.setAttribute('tabindex', '0');
  hitEl.addEventListener('pointermove', (e) => onEnter(e.clientX, e.clientY));
  hitEl.addEventListener('pointerenter', (e) => onEnter(e.clientX, e.clientY));
  hitEl.addEventListener('pointerleave', hideTooltip);
  hitEl.addEventListener('focus', () => {
    const r = hitEl.getBoundingClientRect();
    onEnter(r.left + r.width / 2, r.top);
  });
  hitEl.addEventListener('blur', hideTooltip);
}

/* ---------------- table-view twin (accessibility) ---------------- */

function buildTableToggle(wrapEl, columns, rows) {
  const btn = el('button', { className: 'table-toggle-btn', type: 'button', textContent: '표로 보기' });
  const tableWrap = el('div', { className: 'table-scroll' });
  tableWrap.style.display = 'none';
  tableWrap.style.marginTop = '12px';

  const thead = el('thead', {}, [el('tr', {}, columns.map((c) => el('th', { textContent: c })))]);
  const tbody = el('tbody', {}, rows.map((r) => el('tr', {}, r.map((v) => el('td', { textContent: String(v) })))));
  tableWrap.appendChild(el('table', {}, [thead, tbody]));

  let open = false;
  btn.addEventListener('click', () => {
    open = !open;
    tableWrap.style.display = open ? '' : 'none';
    btn.textContent = open ? '차트로 보기' : '표로 보기';
  });

  wrapEl.appendChild(btn);
  wrapEl.appendChild(tableWrap);
}

/* ================================================================
   S1 — KPI cards
   ================================================================ */

function renderKPI(summary) {
  const grid = document.getElementById('kpi-grid');
  clear(grid);

  const cards = [
    {
      label: '총 매매 건수',
      value: fmtCount(summary.totalDeals),
      sub: '2025-07 ~ 2026-06, 서울 전체',
    },
    {
      label: '중위 매매가',
      value: fmtWon(summary.medianPrice),
      sub: '전체 매매 실거래 기준',
    },
    {
      label: '중위 평당가',
      value: `${fmtPyeong(summary.medianPricePerPyeong)}/평`,
      sub: '전체 기간 기준',
    },
    {
      label: '반기 변화율',
      value: fmtPct(summary.changeRate),
      sub: `H1(${fmtPyeong(summary.h1MedianPricePerPyeong)}) → H2(${fmtPyeong(summary.h2MedianPricePerPyeong)})`,
      delta: summary.changeRate,
    },
  ];

  for (const c of cards) {
    const valueEl = el('div', { className: 'kpi-value', textContent: c.value });
    if (c.delta !== undefined) valueEl.classList.add(deltaClass(c.delta));
    grid.appendChild(el('div', { className: 'kpi-card' }, [
      el('span', { className: 'caption1', textContent: c.label }),
      valueEl,
      el('span', { className: 'body1 kpi-sub', textContent: c.sub }),
    ]));
  }
}

/* ================================================================
   S2 — headline diverging bar chart (25 gu)
   ================================================================ */

function renderDiverging(guList) {
  const wrap = document.getElementById('s2-chart-wrap');
  clear(wrap);

  const rows = [...guList].sort((a, b) => b.changeRate - a.changeRate);

  const rowH = 26;
  const top = 26;
  const bottom = 10;
  const W = 680;
  const H = top + rows.length * rowH + bottom;
  const labelW = 78;
  const plotLeft = labelW + 10;
  const plotRight = W - 56;
  const plotWidth = plotRight - plotLeft;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.changeRate)));
  const domain = Math.ceil(maxAbs / 5) * 5;
  const center = plotLeft + plotWidth / 2;
  const halfWidth = plotWidth / 2;
  const pxPerUnit = halfWidth / domain;

  const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '서울 25개 구 반기 평당가 변화율 다이버징 바 차트' });

  // zero baseline
  svgRoot.appendChild(svg('line', {
    x1: center, y1: top - 14, x2: center, y2: H - bottom, class: 'axis-line',
  }));
  svgRoot.appendChild(svg('text', { x: center, y: top - 18, class: 'axis-label', 'text-anchor': 'middle' })).textContent = '0%';

  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const barH = 15;
    const barY = y + (rowH - barH) / 2;
    const barW = Math.abs(r.changeRate) * pxPerUnit;
    const isUp = r.changeRate >= 0;
    const x = isUp ? center : center - barW;

    const g = svg('g');

    g.appendChild(svg('text', {
      x: labelW, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'value-label', 'font-weight': '500',
    }));
    g.lastChild.textContent = r.gu;

    const bar = svg('rect', {
      x, y: barY, width: Math.max(barW, 1.5), height: barH, rx: 3,
      class: isUp ? 'bar-rise' : 'bar-fall',
    });
    g.appendChild(bar);

    const labelX = isUp ? x + barW + 6 : x - 6;
    const label = svg('text', {
      x: labelX, y: y + rowH / 2 + 4, 'text-anchor': isUp ? 'start' : 'end', class: 'value-label',
    });
    label.textContent = fmtPct(r.changeRate);
    label.setAttribute('fill', isUp ? 'var(--color-rise-strong)' : 'var(--color-fall-strong)');
    g.appendChild(label);

    // hover hit area spans the full row
    const hit = svg('rect', {
      x: 0, y, width: W, height: rowH, class: 'mark-hit',
    });
    g.appendChild(hit);
    attachHover(hit, (cx, cy) => {
      showTooltip(cx, cy, r.gu, [
        ['반기 변화율', fmtPct(r.changeRate)],
        ['거래 건수', fmtCount(r.dealCount)],
        ['중위 평당가', `${fmtPyeong(r.medianPricePerPyeong)}/평`],
      ]);
      bar.classList.add('bar-hovered');
    });
    hit.addEventListener('pointerleave', () => bar.classList.remove('bar-hovered'));
    hit.addEventListener('blur', () => bar.classList.remove('bar-hovered'));

    // click to drill: sync S3 / S6 selectors to this gu
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', () => onGuPick(r.gu));

    svgRoot.appendChild(g);
  });

  wrap.appendChild(svgRoot);
  wrap.appendChild(el('p', { className: 'chart-caption body1', textContent: '막대를 클릭하면 아래 S3 월별 추이와 S6 동 드릴다운이 해당 구로 이동합니다.' }));

  buildTableToggle(wrap, ['구', '반기 변화율', '거래 건수', '중위 평당가(만원/평)'],
    rows.map((r) => [r.gu, fmtPct(r.changeRate), fmtCount(r.dealCount), fmtPyeong(r.medianPricePerPyeong)]));
}

/* ================================================================
   S3 — monthly combo chart (bars = deal count, line = price/pyeong)
   ================================================================ */

const MONTH_LABEL = (ym) => `${parseInt(ym.split('-')[1], 10)}월`;

function renderCombo(monthly, title) {
  const wrap = document.getElementById('s3-chart-wrap');
  clear(wrap);

  const W = 880;
  const H = 340;
  const plotLeft = 20;
  const plotRight = W - 20;
  const plotTop = 24;
  const plotBottom = H - 46;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const n = monthly.length;
  const slotW = plotWidth / n;
  const barW = Math.min(24, slotW * 0.46);

  const maxDeal = Math.max(...monthly.map((m) => m.dealCount));
  const prices = monthly.map((m) => m.medianPricePerPyeong);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pPad = (maxP - minP) * 0.2 || maxP * 0.1 || 1;
  const pLo = Math.max(0, minP - pPad);
  const pHi = maxP + pPad;

  const barY = (v) => plotBottom - (v / maxDeal) * plotHeight;
  const lineY = (v) => plotBottom - ((v - pLo) / (pHi - pLo)) * plotHeight;
  const slotX = (i) => plotLeft + i * slotW + slotW / 2;

  const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title} 월별 거래 건수 및 중위 평당가 추이` });

  // baseline
  svgRoot.appendChild(svg('line', { x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom, class: 'axis-line' }));

  const points = [];

  monthly.forEach((m, i) => {
    const cx = slotX(i);
    const h = plotBottom - barY(m.dealCount);
    const bar = svg('rect', {
      x: cx - barW / 2, y: barY(m.dealCount), width: barW, height: Math.max(h, 1), rx: 3,
      fill: 'var(--color-rise-bg-strong)',
    });
    svgRoot.appendChild(bar);

    svgRoot.appendChild(svg('text', {
      x: cx, y: plotBottom + 18, 'text-anchor': 'middle', class: 'axis-label',
    })).textContent = MONTH_LABEL(m.ym);

    points.push([cx, lineY(m.medianPricePerPyeong)]);

    // hover hit spans full column height
    const hit = svg('rect', { x: plotLeft + i * slotW, y: plotTop, width: slotW, height: plotBottom - plotTop + 20, class: 'mark-hit' });
    svgRoot.appendChild(hit);
    attachHover(hit, (clientX, clientY) => {
      showTooltip(clientX, clientY, `${title} · ${m.ym}`, [
        ['거래 건수', fmtCount(m.dealCount)],
        ['중위 평당가', `${fmtPyeong(m.medianPricePerPyeong)}/평`],
      ]);
      bar.classList.add('bar-hovered');
    });
    hit.addEventListener('pointerleave', () => bar.classList.remove('bar-hovered'));
    hit.addEventListener('blur', () => bar.classList.remove('bar-hovered'));
  });

  // line
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  svgRoot.appendChild(svg('path', { d, class: 'combo-line' }));

  // end dots + direct labels at first & last point
  [0, points.length - 1].forEach((idx) => {
    const [x, y] = points[idx];
    svgRoot.appendChild(svg('circle', { cx: x, cy: y, r: 4, class: 'dot-point' }));
    const label = svg('text', {
      x, y: y - 10, 'text-anchor': idx === 0 ? 'start' : 'end', class: 'value-label',
    });
    label.textContent = `${fmtPyeong(monthly[idx].medianPricePerPyeong)}/평`;
    svgRoot.appendChild(label);
  });

  wrap.appendChild(svgRoot);

  const legend = el('div', { className: 'chart-legend' }, [
    el('span', { className: 'legend-item' }, [el('span', { className: 'legend-swatch', style: 'background:var(--color-rise-bg-strong)' }), '거래 건수']),
    el('span', { className: 'legend-item' }, [el('span', { className: 'legend-line', style: 'background:var(--color-primary-normal)' }), '중위 평당가(만원/평)']),
  ]);
  wrap.insertBefore(legend, svgRoot);

  wrap.appendChild(el('p', {
    className: 'chart-caption body1',
    textContent: '막대(거래 건수)와 선(중위 평당가)은 서로 다른 축의 값입니다. 두 지표를 비교할 때는 반드시 각 라벨/툴팁의 실제 수치를 확인하세요 — 겹쳐 보이는 모양이 상관관계를 뜻하지 않습니다.',
  }));

  buildTableToggle(wrap, ['월', '거래 건수', '중위 평당가(만원/평)'],
    monthly.map((m) => [m.ym, fmtCount(m.dealCount), fmtPyeong(m.medianPricePerPyeong)]));
}

/* ================================================================
   S4 — rising / falling dong rankings
   ================================================================ */

function renderRankings(dongList) {
  const eligible = dongList.filter((d) => d.changeRate != null);
  const rising = [...eligible].sort((a, b) => b.changeRate - a.changeRate).slice(0, 10);
  const falling = [...eligible].sort((a, b) => a.changeRate - b.changeRate).slice(0, 10);

  const risingMax = Math.max(...rising.map((d) => Math.abs(d.changeRate)), 0.01);
  const fallingMax = Math.max(...falling.map((d) => Math.abs(d.changeRate)), 0.01);

  fillRankList('rank-rising', rising, risingMax, 'rise');
  fillRankList('rank-falling', falling, fallingMax, 'fall');
}

function fillRankList(listId, items, maxAbs, direction) {
  const list = document.getElementById(listId);
  clear(list);
  items.forEach((d, i) => {
    const pct = Math.max(4, (Math.abs(d.changeRate) / maxAbs) * 100);
    const row = el('li', { className: 'rank-row' }, [
      el('span', { className: 'rank-idx', textContent: String(i + 1) }),
      el('div', { className: 'rank-main' }, [
        el('span', { className: 'rank-name', textContent: `${d.gu} ${d.dong}` }),
        el('span', { className: 'rank-sub', textContent: `거래 ${d.dealCount.toLocaleString('ko-KR')}건 · 평당가 ${fmtPyeong(d.medianPricePerPyeong)}` }),
        el('div', { className: 'rank-bar-track' }, [
          el('div', { className: `rank-bar-fill rank-fill-${direction}`, style: `width:${pct}%` }),
        ]),
      ]),
      el('span', { className: `rank-value ${deltaClass(d.changeRate)}`, textContent: fmtPct(d.changeRate) }),
    ]);
    list.appendChild(row);
  });
}

/* ================================================================
   S5 — budget explorer
   ================================================================ */

function computeEntry(dong, band, budgetManwon) {
  const bands = band === '전체' ? AREA_BANDS : [band];
  let total = 0;
  let included = 0;
  for (const b of bands) {
    const bd = dong.areaBands[b];
    if (!bd) continue;
    total += bd.count;
    for (const [idx, c] of bd.hist) {
      const lo = idx * 5000;
      const hi = lo + 5000;
      if (hi <= budgetManwon) included += c;
      else if (lo < budgetManwon) included += c * ((budgetManwon - lo) / 5000);
    }
  }
  if (total < 10) return { pct: null, total };
  return { pct: Math.min(100, (included / total) * 100), total };
}

function setupBudgetExplorer(dongList) {
  const slider = document.getElementById('budget-range');
  const numberInput = document.getElementById('budget-number');
  const areaSelect = document.getElementById('budget-area');
  const readout = document.getElementById('budget-readout');
  const summaryEl = document.getElementById('budget-summary');
  const tbody = document.getElementById('budget-tbody');

  function render() {
    const budget = Number(slider.value);
    numberInput.value = (budget / 10000).toFixed(1);
    readout.textContent = fmtEok(budget);
    const band = areaSelect.value;

    const results = dongList.map((d) => {
      const { pct, total } = computeEntry(d, band, budget);
      return { d, pct, total };
    });

    results.sort((a, b) => {
      if (a.pct == null && b.pct == null) return 0;
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return b.pct - a.pct;
    });

    const affordable = results.filter((r) => r.pct != null && r.pct >= 30).length;
    summaryEl.textContent = `예산 ${fmtEok(budget)} 이내 진입 가능 동(거래의 30% 이상, 표본 10건 이상 기준): ${affordable}개 / 전체 ${dongList.length}개`;

    clear(tbody);
    results.slice(0, 30).forEach((r, i) => {
      const pctStr = r.pct == null ? '—' : `${r.pct.toFixed(1)}%`;
      const barPct = r.pct == null ? 0 : r.pct;
      const tr = el('tr', {}, [
        el('td', { textContent: String(i + 1) }),
        el('td', { textContent: `${r.d.gu} ${r.d.dong}` }),
        el('td', { className: 'num', textContent: fmtWon(r.d.medianPrice) }),
        el('td', {}, [
          el('div', { className: 'inline-bar-cell' }, [
            el('div', { className: 'inline-bar-track' }, [
              el('div', { className: 'inline-bar-fill', style: `width:${barPct}%` }),
            ]),
            el('span', { className: r.pct == null ? 'inline-bar-value cell-null' : 'inline-bar-value', textContent: pctStr }),
          ]),
        ]),
        el('td', { className: 'num', textContent: fmtCount(Math.round(r.total)) }),
        el('td', { className: `num ${deltaClass(r.d.changeRate)}`, textContent: fmtPct(r.d.changeRate) }),
      ]);
      tbody.appendChild(tr);
    });
  }

  slider.addEventListener('input', render);
  numberInput.addEventListener('change', () => {
    let v = Math.round(Number(numberInput.value) * 10000);
    v = Math.round(v / 5000) * 5000; // snap to the 5,000만원 bin grid
    v = Math.min(500000, Math.max(30000, v));
    slider.value = String(v);
    render();
  });
  areaSelect.addEventListener('change', render);

  render();
}

/* ================================================================
   S6 — gu -> dong drilldown, sortable table
   ================================================================ */

const DRILLDOWN_COLUMNS = [
  { key: 'dong', label: '동', numeric: false },
  { key: 'medianPrice', label: '중위가', numeric: true, fmt: fmtWon },
  { key: 'medianPricePerPyeong', label: '중위 평당가', numeric: true, fmt: (v) => fmtPyeong(v) },
  { key: 'dealCount', label: '거래량', numeric: true, fmt: fmtCount },
  { key: 'changeRate', label: '반기 변화율', numeric: true, fmt: (v) => fmtPct(v) },
  { key: 'jeonseRatio', label: '전세가율', numeric: true, fmt: (v) => (v == null ? '—' : `${v.toFixed(1)}%`) },
];

let drilldownState = { sortKey: 'dealCount', sortDir: 'desc' };

function setupDrilldown(dongList, guNames) {
  const select = document.getElementById('drilldown-gu');
  clear(select);
  guNames.forEach((g) => select.appendChild(el('option', { value: g, textContent: g })));
  select.value = guNames[0];

  const theadRow = document.getElementById('drilldown-thead-row');
  clear(theadRow);
  DRILLDOWN_COLUMNS.forEach((col) => {
    const th = el('th', { className: col.numeric ? 'num' : '' });
    const btn = el('button', { className: 'sort-btn', type: 'button' }, [
      col.label,
      el('span', { className: 'sort-arrow', textContent: '▲▼' }),
    ]);
    btn.addEventListener('click', () => {
      if (drilldownState.sortKey === col.key) {
        drilldownState.sortDir = drilldownState.sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        drilldownState.sortKey = col.key;
        drilldownState.sortDir = col.numeric ? 'desc' : 'asc';
      }
      renderDrilldownTable(dongList, select.value);
    });
    th.appendChild(btn);
    theadRow.appendChild(th);
  });

  select.addEventListener('change', () => renderDrilldownTable(dongList, select.value));
  renderDrilldownTable(dongList, select.value);
}

function renderDrilldownTable(dongList, gu) {
  const tbody = document.getElementById('drilldown-tbody');
  clear(tbody);
  const rows = dongList.filter((d) => d.gu === gu);
  const { sortKey, sortDir } = drilldownState;
  rows.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv, 'ko') : bv.localeCompare(av, 'ko');
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  // update arrow indicators
  document.querySelectorAll('#drilldown-thead-row .sort-arrow').forEach((a, i) => {
    a.classList.toggle('active', DRILLDOWN_COLUMNS[i].key === sortKey);
    a.textContent = DRILLDOWN_COLUMNS[i].key === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼';
  });

  rows.forEach((d) => {
    const tr = el('tr');
    DRILLDOWN_COLUMNS.forEach((col) => {
      const raw = d[col.key];
      const text = col.fmt ? col.fmt(raw) : raw;
      const td = el('td', { className: col.numeric ? 'num' : '' , textContent: text });
      if (raw == null) td.classList.add('cell-null');
      if ((col.key === 'changeRate') && raw != null) td.classList.add(deltaClass(raw));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  const caption = document.getElementById('drilldown-caption');
  caption.textContent = `${gu} · 동 ${rows.length}개`;
}

/* ================================================================
   S7 — scatter: price/pyeong vs jeonse ratio
   ================================================================ */

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  return { r, slope, intercept };
}

function renderScatter(dongList) {
  const withJeonse = dongList.filter((d) => d.jeonseRatio != null);
  const xs = withJeonse.map((d) => d.medianPricePerPyeong);
  const ys = withJeonse.map((d) => d.jeonseRatio);
  const { r, slope, intercept } = pearson(xs, ys);

  const withBoth = dongList.filter((d) => d.jeonseRatio != null && d.changeRate != null);
  const r2 = pearson(withBoth.map((d) => d.changeRate), withBoth.map((d) => d.jeonseRatio)).r;

  // r/r2는 로드된 data/*.json으로부터 실시간 계산한 값을 그대로 표기한다(PRD §4.2 참고값과
  // 소수점 셋째 자리에서 근소한 차이가 있을 수 있으나, 화면 수치는 항상 실제 렌더 데이터와 일치해야 한다).
  document.getElementById('s7-stat-r').textContent = `r = ${r.toFixed(3)} (n=${withJeonse.length})`;
  document.getElementById('s7-stat-r2').textContent = `참고: 반기 변화율 ↔ 전세가율의 상관은 r = ${r2.toFixed(3)}로 약합니다. "많이 오른 곳일수록 갭이 크다"고 단정할 수 없습니다 — 비싼 곳일수록 갭이 크다는 관계(r=${r.toFixed(3)})가 훨씬 강합니다.`;

  const wrap = document.getElementById('s7-chart-wrap');
  clear(wrap);

  const W = 760;
  const H = 460;
  const plotLeft = 64;
  const plotRight = W - 20;
  const plotTop = 20;
  const plotBottom = H - 44;

  const maxX = Math.max(...xs);
  const minX = Math.min(...xs);
  const xDomain = [0, Math.ceil((maxX * 1.05) / 5000) * 5000];
  const yDomain = [0, Math.ceil((Math.max(...ys) * 1.08) / 10) * 10];

  const xScale = (v) => plotLeft + (v - xDomain[0]) / (xDomain[1] - xDomain[0]) * (plotRight - plotLeft);
  const yScale = (v) => plotBottom - (v - yDomain[0]) / (yDomain[1] - yDomain[0]) * (plotBottom - plotTop);

  const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '동별 중위 평당가와 전세가율의 산점도' });

  // gridlines + axis ticks
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const v = xDomain[0] + ((xDomain[1] - xDomain[0]) / xTicks) * i;
    const x = xScale(v);
    svgRoot.appendChild(svg('line', { x1: x, y1: plotTop, x2: x, y2: plotBottom, class: 'grid-line' }));
    svgRoot.appendChild(svg('text', { x, y: plotBottom + 18, 'text-anchor': 'middle', class: 'axis-label' })).textContent = `${Math.round(v / 1000)}천`;
  }
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = yDomain[0] + ((yDomain[1] - yDomain[0]) / yTicks) * i;
    const y = yScale(v);
    svgRoot.appendChild(svg('line', { x1: plotLeft, y1: y, x2: plotRight, y2: y, class: 'grid-line' }));
    svgRoot.appendChild(svg('text', { x: plotLeft - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' })).textContent = `${Math.round(v)}%`;
  }
  svgRoot.appendChild(svg('line', { x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom, class: 'axis-line' }));
  svgRoot.appendChild(svg('line', { x1: plotLeft, y1: plotTop, x2: plotLeft, y2: plotBottom, class: 'axis-line' }));

  // trendline
  const tx1 = xDomain[0];
  const tx2 = xDomain[1];
  svgRoot.appendChild(svg('line', {
    x1: xScale(tx1), y1: yScale(slope * tx1 + intercept),
    x2: xScale(tx2), y2: yScale(slope * tx2 + intercept),
    class: 'trend-line',
  }));

  // points
  withJeonse.forEach((d) => {
    const cx = xScale(d.medianPricePerPyeong);
    const cy = yScale(d.jeonseRatio);
    const dot = svg('circle', { cx, cy, r: 4, class: 'dot-point' });
    const hit = svg('circle', { cx, cy, r: 12, class: 'mark-hit' });
    svgRoot.appendChild(dot);
    svgRoot.appendChild(hit);
    attachHover(hit, (clientX, clientY) => {
      showTooltip(clientX, clientY, `${d.gu} ${d.dong}`, [
        ['중위 평당가', `${fmtPyeong(d.medianPricePerPyeong)}/평`],
        ['전세가율', `${d.jeonseRatio.toFixed(1)}%`],
      ]);
      dot.setAttribute('r', 6);
    });
    hit.addEventListener('pointerleave', () => dot.setAttribute('r', 4));
    hit.addEventListener('blur', () => dot.setAttribute('r', 4));
  });

  svgRoot.appendChild(svg('text', { x: (plotLeft + plotRight) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-label' })).textContent = '중위 평당가(만원/평)';
  svgRoot.appendChild(svg('text', {
    x: 14, y: (plotTop + plotBottom) / 2, 'text-anchor': 'middle', class: 'axis-label',
    transform: `rotate(-90 14 ${(plotTop + plotBottom) / 2})`,
  })).textContent = '전세가율(%)';

  wrap.appendChild(svgRoot);

  const legend = el('div', { className: 'chart-legend' }, [
    el('span', { className: 'legend-item' }, [el('span', { className: 'legend-swatch', style: 'background:var(--color-primary-normal); border-radius:50%' }), '동(단지 매칭 표본 3건 이상)']),
    el('span', { className: 'legend-item' }, [el('span', { className: 'legend-line', style: 'background:var(--neutral-40); border-top:2px dashed var(--neutral-40); height:0' }), '추세선(선형회귀)']),
  ]);
  wrap.insertBefore(legend, svgRoot);

  buildTableToggle(wrap, ['구', '동', '중위 평당가(만원/평)', '전세가율(%)'],
    withJeonse.map((d) => [d.gu, d.dong, fmtPyeong(d.medianPricePerPyeong), d.jeonseRatio.toFixed(1)]));
}

/* ================================================================
   cross-section navigation
   ================================================================ */

let STATE = { gu: null, dong: null };

function onGuPick(guName) {
  const s3Select = document.getElementById('s3-gu-select');
  const s6Select = document.getElementById('drilldown-gu');
  if (s3Select) {
    s3Select.value = guName;
    s3Select.dispatchEvent(new Event('change'));
  }
  if (s6Select) {
    s6Select.value = guName;
    s6Select.dispatchEvent(new Event('change'));
  }
}

/* ================================================================
   boot
   ================================================================ */

// 데이터 경로는 페이지 URL이 아니라 이 스크립트(assets/dashboard.js)의 위치를 기준으로 잡는다.
// 페이지 URL 기준으로 하면 끝 슬래시 유무(/부동산-실습 vs /부동산-실습/)에 따라
// 상대경로가 다른 곳으로 풀려 데이터가 통째로 404 나면서도 화면엔 빈 차트만 남는다.
const DATA_BASE = new URL('../data/', import.meta.url);
const loadJSON = (name) =>
  fetch(new URL(name, DATA_BASE)).then((r) => {
    if (!r.ok) throw new Error(`${name} 불러오기 실패 (${r.status})`);
    return r.json();
  });

async function main() {
  const [summary, guList, dongList, meta] = await Promise.all([
    loadJSON('summary.json'),
    loadJSON('gu.json'),
    loadJSON('dong.json'),
    loadJSON('meta.json'),
  ]);

  document.getElementById('header-total').textContent = fmtCount(meta.counts['매매']);
  document.getElementById('header-generated').textContent = new Date(meta.generatedAt).toLocaleDateString('ko-KR');

  renderKPI(summary);
  renderDiverging(guList);
  renderRankings(dongList);
  setupBudgetExplorer(dongList);
  renderScatter(dongList);

  const guNames = guList.map((g) => g.gu).sort((a, b) => a.localeCompare(b, 'ko'));

  // S3 gu selector
  const s3Select = document.getElementById('s3-gu-select');
  clear(s3Select);
  s3Select.appendChild(el('option', { value: '__all__', textContent: '전체 서울' }));
  guNames.forEach((g) => s3Select.appendChild(el('option', { value: g, textContent: g })));
  s3Select.addEventListener('change', () => {
    if (s3Select.value === '__all__') {
      renderCombo(summary.monthly, '서울 전체');
    } else {
      const gu = guList.find((g) => g.gu === s3Select.value);
      renderCombo(gu.monthly, gu.gu);
    }
  });
  renderCombo(summary.monthly, '서울 전체');

  // S6 drilldown
  setupDrilldown(dongList, guNames);

  document.querySelectorAll('.loading-state').forEach((n) => n.remove());
}

main().catch((err) => {
  console.error('대시보드 초기화 실패', err);
  const main2 = document.querySelector('main');
  if (main2) {
    main2.prepend(el('div', {
      className: 'card',
      style: 'border-color:var(--color-fall-normal)',
      textContent: `데이터를 불러오지 못했습니다: ${err.message}`,
    }));
  }
});
