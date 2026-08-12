const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_SIZE = 24;
const HIGHLIGHT_FROM = 2014, HIGHLIGHT_TO = 2017;

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString('ko-KR');
const pct = (n) => `${n.toFixed(1)}%`;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function fail(sel, msg) {
  const host = $(sel);
  if (host) host.innerHTML = `<p class="state-msg error">${msg}</p>`;
}

/* ---------- 툴팁 ---------- */
const tooltip = $('#viz-tooltip');
function showTip(evt, title, rows) {
  tooltip.innerHTML = '';
  tooltip.appendChild(el('div', { class: 'tt-title' }, title));
  rows.forEach(([k, v]) => {
    const row = el('div', { class: 'tt-row' });
    row.appendChild(el('span', {}, k));
    row.appendChild(el('span', { class: 'tt-val' }, v));
    tooltip.appendChild(row);
  });
  tooltip.style.left = `${evt.clientX}px`;
  tooltip.style.top = `${evt.clientY}px`;
  tooltip.classList.add('visible');
}
function hideTip() { tooltip.classList.remove('visible'); }

function bindTip(node, title, rows) {
  node.addEventListener('mousemove', (e) => showTip(e, title, rows));
  node.addEventListener('mouseleave', hideTip);
}

/* ---------- S0 메타 · S1 KPI ---------- */
function renderMeta(d) {
  const [y1, m1, d1] = d.meta.releaseRange.min.split('-');
  const [y2, m2] = d.meta.releaseRange.max.split('-');
  $('#meta-total').textContent = `${fmt(d.meta.totalGames)}종`;
  $('#meta-range').textContent = `${y1}.${m1} ~ ${y2}.${m2}`;
  $('#meta-ref').textContent = d.meta.refDate.replace(/-/g, '.');
  void d1;
}

function renderKpi(d) {
  const cards = [
    ['총 게임 수', `${fmt(d.meta.totalGames)}종`, `중복 없음 · 결측 없음`],
    ['장르', `${d.meta.genreCount}종`, `원본 ${d.meta.genreRawCount}종을 정리`],
    ['퍼블리셔', `${fmt(d.meta.publisherCount)}곳`, `개발사 ${fmt(d.meta.developerCount)}곳`],
    ['중위 게임 나이', `${d.ages.median.toFixed(1)}년`, `절반이 ${d.ages.median.toFixed(1)}년보다 오래됨`],
    ['브라우저 동시 지원', `${d.meta.browserGames}종`, `나머지는 Windows 전용`],
  ];
  const host = $('#kpi-grid');
  host.innerHTML = '';
  cards.forEach(([label, value, sub]) => {
    const card = el('div', { class: 'kpi-card' });
    card.appendChild(el('span', { class: 'label1', style: 'color:var(--color-label-neutral)' }, label));
    card.appendChild(el('span', { class: 'kpi-value' }, value));
    card.appendChild(el('span', { class: 'kpi-sub caption1' }, sub));
    host.appendChild(card);
  });
}

/* ---------- S2 장르 막대 ---------- */
function renderGenres(d) {
  const rows = d.genres;
  const W = 900, ROW_H = 32, PAD_T = 8, LABEL_W = 108, VALUE_W = 132;
  const H = PAD_T * 2 + rows.length * ROW_H;
  const barMax = W - LABEL_W - VALUE_W - 16;
  const max = rows[0].n;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `장르별 게임 수. ${rows.map((r) => `${r.genre} ${r.n}종`).join(', ')}.`,
  });

  rows.forEach((r, i) => {
    const y = PAD_T + i * ROW_H;
    const w = Math.max(2, (r.n / max) * barMax);
    const top2 = i < 2;

    svg.appendChild(svgEl('text', {
      x: LABEL_W - 10, y: y + ROW_H / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle',
      fill: top2 ? 'var(--color-label-normal)' : 'var(--color-label-neutral)',
      'font-size': 13, 'font-weight': top2 ? 700 : 500,
    }, r.genre));

    const bar = svgEl('rect', {
      x: LABEL_W, y: y + 6, width: w, height: ROW_H - 14, rx: 4,
      fill: top2 ? 'var(--blue-50)' : 'var(--blue-90)',
    });
    svg.appendChild(bar);
    bindTip(bar, r.genre, [['게임 수', `${r.n}종`], ['비중', pct(r.share)]]);

    svg.appendChild(svgEl('text', {
      x: LABEL_W + w + 10, y: y + ROW_H / 2, 'dominant-baseline': 'middle',
      fill: 'var(--color-label-normal)', 'font-size': 13, 'font-weight': 600,
    }, `${r.n}종 (${pct(r.share)})`));
  });

  const host = $('#chart-genre');
  host.innerHTML = '';
  host.appendChild(svg);

  $('#caption-genre').textContent =
    `상위 2개 장르(${rows[0].genre}·${rows[1].genre})가 ${d.headline.top2N}종으로 전체의 ${pct(d.headline.top2Share)}, ` +
    `상위 3개까지는 ${pct(d.headline.top3Share)}입니다. 집중도 지수(HHI)는 ${fmt(d.headline.hhi)}로, ` +
    `2,500 이상이면 '고집중'으로 보는 기준에 근접합니다. 하위 6개 장르를 다 합쳐도 ${d.headline.tailN}종(${pct(d.headline.tailShare)})에 그칩니다.`;
}

/* ---------- S3 연도별 ---------- */
function renderYears(d) {
  const rows = d.years;
  const W = 900, H = 320, PAD = { t: 16, r: 16, b: 44, l: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const max = Math.ceil(Math.max(...rows.map((r) => r.n)) / 5) * 5;
  const bandW = plotW / rows.length;
  const barW = Math.min(bandW - 4, 22);
  const x = (i) => PAD.l + i * bandW + bandW / 2;
  const y = (v) => PAD.t + plotH - (v / max) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `1997년부터 2024년까지 연도별 무료 게임 출시 수. 정점은 2014년과 2015년 각 29종이며, 2024년은 원본 스냅샷이 6월까지라 미완결입니다.`,
  });

  // 2014~2017 하이라이트
  const hFrom = rows.findIndex((r) => r.year === HIGHLIGHT_FROM);
  const hTo = rows.findIndex((r) => r.year === HIGHLIGHT_TO);
  if (hFrom >= 0 && hTo >= 0) {
    svg.appendChild(svgEl('rect', {
      x: PAD.l + hFrom * bandW, y: PAD.t,
      width: (hTo - hFrom + 1) * bandW, height: plotH,
      fill: 'var(--blue-95)', rx: 4,
    }));
  }

  // 눈금
  for (let v = 0; v <= max; v += 5) {
    svg.appendChild(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'grid-line' }));
    svg.appendChild(svgEl('text', {
      x: PAD.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'axis-label',
    }, v));
  }

  // 미완결 연도용 빗금 패턴
  const defs = svgEl('defs');
  const pattern = svgEl('pattern', {
    id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  });
  pattern.appendChild(svgEl('rect', { width: 6, height: 6, fill: 'var(--blue-90)' }));
  pattern.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--blue-50)', 'stroke-width': 3 }));
  defs.appendChild(pattern);
  svg.appendChild(defs);

  rows.forEach((r, i) => {
    if (r.n > 0) {
      const bar = svgEl('rect', {
        x: x(i) - barW / 2, y: y(r.n), width: barW, height: PAD.t + plotH - y(r.n), rx: 3,
        fill: r.incomplete ? 'url(#hatch)' : 'var(--blue-50)',
      });
      svg.appendChild(bar);
      bindTip(bar, `${r.year}년`, [
        ['출시', `${r.n}종`],
        ['3년 이동평균', r.ma3 === null ? '—' : `${r.ma3.toFixed(1)}종`],
        ...(r.incomplete ? [['참고', '6월까지만 집계']] : []),
      ]);
    }
    if (r.year % 3 === 1 || i === rows.length - 1) {
      svg.appendChild(svgEl('text', {
        x: x(i), y: H - PAD.b + 18, 'text-anchor': 'middle', class: 'axis-label',
      }, r.year));
    }
  });

  // 3년 이동평균 선
  const pts = rows.map((r, i) => (r.ma3 === null ? null : `${x(i)},${y(r.ma3)}`)).filter(Boolean);
  svg.appendChild(svgEl('polyline', { points: pts.join(' '), class: 'trend-line' }));

  // 하이라이트 라벨
  if (hFrom >= 0) {
    const total = rows.filter((r) => r.year >= HIGHLIGHT_FROM && r.year <= HIGHLIGHT_TO).reduce((s, r) => s + r.n, 0);
    svg.appendChild(svgEl('text', {
      x: PAD.l + (hFrom + (hTo - hFrom + 1) / 2) * bandW, y: PAD.t + 14,
      'text-anchor': 'middle', fill: 'var(--color-primary-heavy)', 'font-size': 12, 'font-weight': 700,
    }, `4년간 ${total}종 (${pct((total / 328) * 100)})`));
  }

  svg.appendChild(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(0), y2: y(0), class: 'axis-line' }));

  const host = $('#chart-years');
  host.innerHTML = '';
  host.appendChild(svg);

  $('#caption-years').textContent =
    `1997~2013년 17년 동안 100종이 나왔는데, 2014~2017년 4년 동안 108종이 나왔습니다. ` +
    `정점은 2014년과 2015년으로 각각 29종입니다. ` +
    `맨 오른쪽 빗금 막대(2024년)는 원본 데이터가 6월 22일까지만 담고 있어 한 해 전체가 아닙니다 — 다른 해와 그대로 비교하면 안 됩니다.`;
}

/* ---------- S4 히트맵 ---------- */
function renderHeatmap(d) {
  const table = el('table', { class: 'heatmap' });

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', { class: 'corner', scope: 'col' }, '장르'));
  d.eras.forEach((e) => hr.appendChild(el('th', { scope: 'col' }, e.label.replace('-', '~'))));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  d.heatmap.forEach((row) => {
    const tr = el('tr');
    const th = el('th', { class: 'hm-genre', scope: 'row' });
    th.appendChild(document.createTextNode(row.genre));
    th.appendChild(el('span', { class: 'hm-total' }, `${row.total}종`));
    tr.appendChild(th);

    const rowMax = Math.max(...row.cells);
    row.cells.forEach((n, i) => {
      const shareInRow = row.total ? (n / row.total) * 100 : 0;
      const intensity = rowMax ? n / rowMax : 0;
      const td = el('td', {
        class: 'hm-cell',
        tabindex: 0,
        style: n === 0
          ? 'background:var(--neutral-99); color:var(--color-label-assistive)'
          : `background:color-mix(in srgb, var(--blue-50) ${Math.round(intensity * 100)}%, var(--blue-95)); color:${intensity > 0.55 ? '#fff' : 'var(--color-primary-heavy)'}`,
      }, n === 0 ? '·' : String(n));

      const rows2 = [
        ['게임 수', `${n}종`],
        ['이 장르 안에서', pct(shareInRow)],
        ['이 시기 전체', `${d.eras[i].n}종 중`],
      ];
      bindTip(td, `${row.genre} · ${d.eras[i].label.replace('-', '~')}`, rows2);
      td.addEventListener('focus', (e) => showTip(
        { clientX: td.getBoundingClientRect().left + 28, clientY: td.getBoundingClientRect().top },
        `${row.genre} · ${d.eras[i].label.replace('-', '~')}`, rows2,
      ) || e);
      td.addEventListener('blur', hideTip);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.appendChild(el('th', { scope: 'row' }, '시기별 합계'));
  d.eras.forEach((e) => fr.appendChild(el('td', {}, `${e.n}종`)));
  tfoot.appendChild(fr);
  table.appendChild(tfoot);

  const host = $('#heatmap');
  host.innerHTML = '';
  host.appendChild(table);

  const before = (g) => d.games.filter((x) => x.genre === g && x.year <= 2013).length;
  const after = (g) => d.games.filter((x) => x.genre === g && x.year >= 2014).length;
  const poolBefore = d.games.filter((x) => x.year <= 2013).length;
  const poolAfter = d.games.filter((x) => x.year >= 2014).length;

  $('#caption-heatmap').textContent =
    `2013년까지 출시된 ${poolBefore}종 중 MMORPG가 ${before('MMORPG')}종(${pct((before('MMORPG') / poolBefore) * 100)})으로 압도적이었지만, ` +
    `2014년 이후 출시된 ${poolAfter}종에서는 Shooter가 ${after('Shooter')}종(${pct((after('Shooter') / poolAfter) * 100)})으로 ` +
    `MMORPG ${after('MMORPG')}종(${pct((after('MMORPG') / poolAfter) * 100)})을 앞섭니다. ` +
    `전체 누적으로는 MMORPG가 여전히 1위지만, 새로 나오는 게임의 주인공은 바뀌었습니다. ` +
    `Card Game은 2013년 이전에 한 종도 없다가 이후 ${after('Card Game')}종이 등장했습니다. ` +
    `Racing(3종)처럼 게임 수가 적은 행은 한두 종만으로 색이 진해지므로 색보다 숫자를 함께 보세요.`;
}

/* ---------- S5 나이 분포 ---------- */
function renderAges(d) {
  const bins = d.ages.bins;
  const W = 900, H = 300, PAD = { t: 32, r: 16, b: 48, l: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const max = Math.ceil(Math.max(...bins.map((b) => b.n)) / 10) * 10;
  const bandW = plotW / bins.length;
  const y = (v) => PAD.t + plotH - (v / max) * plotH;
  const label = (b) => (b.to === null ? `${b.from}년+` : `${b.from}-${b.to}`);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `게임 나이 분포. 중위 ${d.ages.median.toFixed(1)}년, 10년 이상이 ${d.ages.over10.n}종으로 ${pct(d.ages.over10.share)}입니다.`,
  });

  // 10년 이상 영역 강조
  const tenIdx = bins.findIndex((b) => b.from >= 10);
  svg.appendChild(svgEl('rect', {
    x: PAD.l + tenIdx * bandW, y: PAD.t, width: plotW - tenIdx * bandW, height: plotH,
    fill: 'var(--neutral-99)', rx: 4,
  }));
  svg.appendChild(svgEl('text', {
    x: PAD.l + tenIdx * bandW + (plotW - tenIdx * bandW) / 2, y: PAD.t - 10,
    'text-anchor': 'middle', fill: 'var(--color-label-neutral)', 'font-size': 12, 'font-weight': 600,
  }, `10년 이상 ${d.ages.over10.n}종 (${pct(d.ages.over10.share)})`));

  for (let v = 0; v <= max; v += 10) {
    svg.appendChild(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'grid-line' }));
    svg.appendChild(svgEl('text', {
      x: PAD.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'axis-label',
    }, v));
  }

  bins.forEach((b, i) => {
    if (b.n > 0) {
      const bar = svgEl('rect', {
        x: PAD.l + i * bandW + 3, y: y(b.n), width: bandW - 6, height: PAD.t + plotH - y(b.n), rx: 3,
        fill: b.from >= 10 ? 'var(--blue-40)' : 'var(--blue-50)',
      });
      svg.appendChild(bar);
      bindTip(bar, `출시 후 ${label(b)}년`, [
        ['게임 수', `${b.n}종`],
        ['비중', pct((b.n / d.games.length) * 100)],
      ]);
    }
    svg.appendChild(svgEl('text', {
      x: PAD.l + i * bandW + bandW / 2, y: H - PAD.b + 18, 'text-anchor': 'middle', class: 'axis-label',
    }, label(b)));
  });

  // 중위선
  const medX = PAD.l + (d.ages.median / 2) * bandW;
  svg.appendChild(svgEl('line', {
    x1: medX, x2: medX, y1: PAD.t, y2: PAD.t + plotH,
    stroke: 'var(--neutral-30)', 'stroke-width': 2, 'stroke-dasharray': '4 3',
  }));
  svg.appendChild(svgEl('text', {
    x: medX + 6, y: PAD.t + 14, fill: 'var(--neutral-30)', 'font-size': 12, 'font-weight': 700,
  }, `중위 ${d.ages.median.toFixed(1)}년`));

  svg.appendChild(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(0), y2: y(0), class: 'axis-line' }));

  const host = $('#chart-ages');
  host.innerHTML = '';
  host.appendChild(svg);

  $('#caption-ages').textContent =
    `절반은 ${d.ages.median.toFixed(1)}년, 평균은 ${d.ages.mean.toFixed(1)}년입니다. ` +
    `출시된 지 10년이 넘은 게임이 ${d.ages.over10.n}종(${pct(d.ages.over10.share)}), 15년이 넘은 게임도 ${d.ages.over15.n}종(${pct(d.ages.over15.share)})입니다. ` +
    `5년 미만은 ${d.ages.under5.n}종(${pct(d.ages.under5.share)})뿐입니다. ` +
    `'무료 게임은 신작 실험장'이라는 인상과 달리, 이 목록은 오래 살아남은 게임들이 채우고 있습니다. ` +
    `다만 원본이 2024년 7월 스냅샷이라 이후 신작이 빠져 있다는 점을 감안해야 합니다.`;
}

/* ---------- S6 탐색기 ---------- */
function setupExplorer(d) {
  const genreSel = $('#f-genre');
  d.genres.forEach((g) => {
    genreSel.appendChild(el('option', { value: g.genre }, `${g.genre} (${g.n})`));
  });
  genreSel.options[0].textContent = `전체 (${d.games.length})`;

  const grid = $('#game-grid');
  const resultLine = $('#result-line');
  const moreWrap = $('#load-more-wrap');
  let shown = PAGE_SIZE;
  let filtered = d.games;

  const state = () => ({
    q: $('#f-search').value.trim().toLowerCase(),
    genre: $('#f-genre').value,
    year: $('#f-year').value,
    platform: $('#f-platform').value,
    sort: $('#f-sort').value,
  });

  function applyFilters() {
    const s = state();
    let list = d.games.filter((g) => {
      if (s.genre && g.genre !== s.genre) return false;
      if (s.platform && g.platform !== s.platform) return false;
      if (s.year) {
        const [a, b] = s.year.split('-').map(Number);
        if (g.year < a || g.year > b) return false;
      }
      if (s.q) {
        const hay = `${g.title} ${g.publisher} ${g.developer} ${g.desc}`.toLowerCase();
        if (!hay.includes(s.q)) return false;
      }
      return true;
    });

    list = list.slice().sort((a, b) => {
      if (s.sort === 'old') return a.release.localeCompare(b.release) || a.title.localeCompare(b.title);
      if (s.sort === 'title') return a.title.localeCompare(b.title);
      if (s.sort === 'genre') return a.genre.localeCompare(b.genre) || b.release.localeCompare(a.release);
      return b.release.localeCompare(a.release) || a.title.localeCompare(b.title);
    });

    filtered = list;
    shown = PAGE_SIZE;
    render();
  }

  function gameCard(g) {
    const li = el('li', { class: 'game-card' });

    const thumb = el('div', { class: 'thumb-box' });
    const img = el('img', {
      src: g.thumbnail, alt: '', loading: 'lazy', decoding: 'async',
      referrerpolicy: 'no-referrer', width: 320, height: 180,
    });
    img.addEventListener('error', () => {
      img.remove();
      thumb.appendChild(el('div', { class: 'thumb-fallback', 'aria-hidden': 'true' }, g.title.charAt(0).toUpperCase()));
    });
    thumb.appendChild(img);
    li.appendChild(thumb);

    const body = el('div', { class: 'game-body' });
    body.appendChild(el('h3', { class: 'game-title' }, g.title));

    const tags = el('div', { class: 'game-tags' });
    tags.appendChild(el('span', { class: 'badge' }, g.genre));
    if (g.platform === 'windows+browser') tags.appendChild(el('span', { class: 'badge badge-muted' }, '브라우저 지원'));
    body.appendChild(tags);

    body.appendChild(el('p', { class: 'game-meta' },
      `${g.publisher} · ${g.release.replace(/-/g, '.')} · 출시 ${g.age.toFixed(1)}년차`));
    body.appendChild(el('p', { class: 'game-desc' }, g.desc));

    const link = el('a', {
      class: 'game-link', href: g.url, target: '_blank', rel: 'noopener noreferrer',
    }, 'FreeToGame에서 보기 ↗');
    link.setAttribute('aria-label', `${g.title} — FreeToGame 원본 페이지 (새 탭)`);
    body.appendChild(link);

    li.appendChild(body);
    return li;
  }

  function render() {
    grid.innerHTML = '';
    resultLine.innerHTML = '';

    if (filtered.length === 0) {
      resultLine.textContent = '조건에 맞는 게임이 없습니다.';
      const empty = el('div', { class: 'empty-state' });
      empty.appendChild(el('p', {}, '검색어나 조건을 바꿔 보세요.'));
      const btn = el('button', { type: 'button', class: 'btn-reset' }, '조건 초기화');
      btn.addEventListener('click', reset);
      empty.appendChild(btn);
      grid.appendChild(empty);
      moreWrap.hidden = true;
      return;
    }

    const page = filtered.slice(0, shown);
    resultLine.appendChild(document.createTextNode(`전체 ${fmt(d.games.length)}종 중 `));
    resultLine.appendChild(el('b', {}, `${fmt(filtered.length)}종`));
    resultLine.appendChild(document.createTextNode(` · ${fmt(page.length)}종 표시 중`));

    const frag = document.createDocumentFragment();
    page.forEach((g) => frag.appendChild(gameCard(g)));
    grid.appendChild(frag);

    moreWrap.hidden = shown >= filtered.length;
    $('#btn-more').textContent = `더 보기 (남은 ${fmt(filtered.length - shown)}종)`;
  }

  function reset() {
    $('#f-search').value = '';
    ['#f-genre', '#f-year', '#f-platform'].forEach((s) => { $(s).value = ''; });
    $('#f-sort').value = 'new';
    applyFilters();
  }

  let debounce;
  $('#f-search').addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(applyFilters, 150);
  });
  ['#f-genre', '#f-year', '#f-platform', '#f-sort'].forEach((s) => {
    $(s).addEventListener('change', applyFilters);
  });
  $('#f-reset').addEventListener('click', reset);
  $('#btn-more').addEventListener('click', () => { shown += PAGE_SIZE; render(); });

  applyFilters();
}

/* ---------- 부팅 ---------- */
async function main() {
  let data;
  try {
    const res = await fetch('data/games.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    ['#kpi-grid', '#chart-genre', '#chart-years', '#heatmap', '#chart-ages'].forEach((s) =>
      fail(s, '데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
    $('#result-line').textContent = '데이터를 불러오지 못해 탐색기를 사용할 수 없습니다.';
    console.error(err);
    return;
  }

  renderMeta(data);
  renderKpi(data);
  renderGenres(data);
  renderYears(data);
  renderHeatmap(data);
  renderAges(data);
  setupExplorer(data);

  $('#limit-extra').textContent =
    `자체 퍼블리싱(퍼블리셔와 개발사가 같은 회사) 게임이 ${data.meta.selfPublished}종으로 전체의 ` +
    `${pct((data.meta.selfPublished / data.meta.totalGames) * 100)}입니다. 다만 이름 표기가 조금만 달라도 다른 회사로 세어지므로 대략적인 값입니다.`;
}

main();
