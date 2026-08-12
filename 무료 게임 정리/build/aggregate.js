// free-to-play-games.csv -> data/games.json
// 의존성 없음. 실행: node build/aggregate.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REF_DATE = '2026-08-12';
const DAYS_PER_YEAR = 365.2425;
const ERA_BOUNDS = [
  [1997, 2003], [2004, 2006], [2007, 2009], [2010, 2012],
  [2013, 2015], [2016, 2018], [2019, 2021], [2022, 2024],
];
const GENRE_MERGE = {
  'Card': 'Card Game',
  'ARPG': 'Action RPG',
  'MMOARPG': 'MMORPG',
  'Action Game': 'Action',
};
const OTHER_LABEL = '기타';
const MIN_GENRE_N = 3;

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const round1 = (n) => Math.round(n * 10) / 10;

const raw = fs.readFileSync(path.join(ROOT, 'free-to-play-games.csv'), 'utf8');
const rows = parseCSV(raw);
const header = rows[0].map((h) => h.trim());
const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));

const malformed = body.filter((r) => r.length !== header.length);
if (malformed.length) {
  throw new Error(`컬럼 수가 ${header.length}이 아닌 행 ${malformed.length}건`);
}

const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const refMs = Date.parse(REF_DATE + 'T00:00:00Z');

const records = body.map((r) => {
  const get = (k) => (r[idx[k]] ?? '').trim();
  const genreRaw = get('genre');
  const release = get('release_date');
  const platformRaw = get('platform');
  return {
    title: get('title'),
    thumbnail: get('thumbnail'),
    desc: get('short_description'),
    url: get('freetogame_profile_url'),
    genreRaw,
    genreMerged: GENRE_MERGE[genreRaw] || genreRaw,
    platform: /Browser/i.test(platformRaw) ? 'windows+browser' : 'windows',
    publisher: get('publisher'),
    developer: get('developer'),
    release,
    year: Number(release.slice(0, 4)),
    ageExact: (refMs - Date.parse(release + 'T00:00:00Z')) / 86400000 / DAYS_PER_YEAR,
  };
});

const badDate = records.filter((g) => !/^\d{4}-\d{2}-\d{2}$/.test(g.release));
if (badDate.length) throw new Error(`날짜 형식 이탈 ${badDate.length}건`);

const TOTAL = records.length;

// --- 장르 정제 2단계: 병합 후 표본 3건 미만은 기타로 ---
const mergedCount = {};
records.forEach((g) => { mergedCount[g.genreMerged] = (mergedCount[g.genreMerged] || 0) + 1; });
const otherMembers = Object.keys(mergedCount).filter((g) => mergedCount[g] < MIN_GENRE_N);
records.forEach((g) => {
  g.genre = otherMembers.includes(g.genreMerged) ? OTHER_LABEL : g.genreMerged;
  g.selfPublished = g.publisher.toLowerCase() === g.developer.toLowerCase();
});

const genreCount = {};
records.forEach((g) => { genreCount[g.genre] = (genreCount[g.genre] || 0) + 1; });
const genres = Object.entries(genreCount)
  .map(([genre, n]) => ({ genre, n, share: round1((n / TOTAL) * 100) }))
  .sort((a, b) => b.n - a.n || a.genre.localeCompare(b.genre));

const hhi = Math.round(genres.reduce((s, g) => s + Math.pow((g.n / TOTAL) * 100, 2), 0));
const top2N = genres[0].n + genres[1].n;
const headline = {
  top2N,
  top2Share: round1((top2N / TOTAL) * 100),
  top3Share: round1(((top2N + genres[2].n) / TOTAL) * 100),
  hhi,
  // 기타는 성격이 다른 묶음이므로 '하위 장르' 합계에서 제외
  tailN: genres.slice(5).filter((g) => g.genre !== OTHER_LABEL).reduce((s, g) => s + g.n, 0),
};
headline.tailShare = round1((headline.tailN / TOTAL) * 100);

// --- 연도별 ---
const yearCount = {};
records.forEach((g) => { yearCount[g.year] = (yearCount[g.year] || 0) + 1; });
const minYear = Math.min(...records.map((g) => g.year));
const maxYear = Math.max(...records.map((g) => g.year));
const years = [];
for (let y = minYear; y <= maxYear; y++) years.push({ year: y, n: yearCount[y] || 0, ma3: null, incomplete: y === maxYear });
years.forEach((y, i) => {
  if (i === 0 || i === years.length - 1) return;
  y.ma3 = round1((years[i - 1].n + y.n + years[i + 1].n) / 3);
});

// --- 시대 구간 ---
const eraOf = (year) => ERA_BOUNDS.findIndex(([a, b]) => year >= a && year <= b);
const eras = ERA_BOUNDS.map(([from, to]) => ({
  label: `${from}-${to}`,
  from, to,
  n: records.filter((g) => g.year >= from && g.year <= to).length,
}));

const heatmap = genres.map(({ genre, n }) => {
  const cells = new Array(ERA_BOUNDS.length).fill(0);
  records.filter((g) => g.genre === genre).forEach((g) => {
    const e = eraOf(g.year);
    if (e >= 0) cells[e]++;
  });
  return { genre, total: n, cells };
});

// --- 나이 분포 ---
const ages = records.map((g) => g.ageExact).sort((a, b) => a - b);
const median = ages.length % 2
  ? ages[(ages.length - 1) / 2]
  : (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2;
const BIN_W = 2, LAST_BIN = 28;
const bins = [];
for (let from = 0; from < LAST_BIN; from += BIN_W) {
  bins.push({ from, to: from + BIN_W, n: ages.filter((a) => a >= from && a < from + BIN_W).length });
}
bins.push({ from: LAST_BIN, to: null, n: ages.filter((a) => a >= LAST_BIN).length });

const share = (n) => ({ n, share: round1((n / TOTAL) * 100) });
const ageStats = {
  median: round1(median),
  mean: round1(ages.reduce((s, a) => s + a, 0) / TOTAL),
  over10: share(ages.filter((a) => a >= 10).length),
  over15: share(ages.filter((a) => a >= 15).length),
  under5: share(ages.filter((a) => a < 5).length),
  bins,
};

// --- 메타 ---
const sortedDates = records.map((g) => g.release).sort();
// 원본 문자열 그대로 센다 (표기 변형은 §8 데이터 한계에 명시)
const uniq = (arr) => new Set(arr).size;
const meta = {
  generatedAt: new Date(refMs).toISOString(),
  refDate: REF_DATE,
  source: 'FreeToGame free-to-play games catalog',
  totalGames: TOTAL,
  malformedRows: 0,
  releaseRange: {
    min: sortedDates[0],
    max: sortedDates[sortedDates.length - 1],
    medianDate: sortedDates[Math.floor(TOTAL / 2)],
  },
  lastCompleteYear: maxYear - 1,
  genreRawCount: new Set(records.map((g) => g.genreRaw)).size,
  genreCount: genres.length,
  genreMerges: Object.entries(GENRE_MERGE).map(([from, to]) => ({
    from, to, n: records.filter((g) => g.genreRaw === from).length,
  })).filter((m) => m.n > 0),
  otherBucket: { label: OTHER_LABEL, n: genreCount[OTHER_LABEL] || 0, members: otherMembers },
  publisherCount: uniq(records.map((g) => g.publisher)),
  developerCount: uniq(records.map((g) => g.developer)),
  selfPublished: records.filter((g) => g.selfPublished).length,
  browserGames: records.filter((g) => g.platform === 'windows+browser').length,
  duplicateTitles: TOTAL - new Set(records.map((g) => g.title)).size,
};

const games = records
  .sort((a, b) => b.release.localeCompare(a.release) || a.title.localeCompare(b.title))
  .map((g) => {
    const o = {
      title: g.title, thumbnail: g.thumbnail, desc: g.desc, url: g.url,
      genre: g.genre, platform: g.platform,
      publisher: g.publisher, developer: g.developer, selfPublished: g.selfPublished,
      release: g.release, year: g.year, age: round1(g.ageExact),
    };
    if (g.genreRaw !== g.genre) o.genreRaw = g.genreRaw;
    return o;
  });

const out = { meta, genres, headline, years, eras, heatmap, ages: ageStats, games };
const outPath = path.join(ROOT, 'data', 'games.json');
fs.writeFileSync(outPath, JSON.stringify(out));

const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`data/games.json 생성 — ${TOTAL}종, 장르 ${genres.length}종, ${kb}KB`);
