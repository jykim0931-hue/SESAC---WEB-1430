#!/usr/bin/env node
'use strict';
/**
 * build/aggregate.js
 *
 * Reads seoul-apt-latest.csv (320,141 apartment transaction rows) and emits
 * four small JSON files into data/ for the static dashboard frontend.
 *
 * Zero external dependencies. Node >= 14.
 *
 * Usage: node build/aggregate.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'seoul-apt-latest.csv');
const OUT_DIR = path.join(ROOT, 'data');

// ---------------------------------------------------------------------------
// Constants (PRD §7)
// ---------------------------------------------------------------------------

const MIN_SAMPLE = {
  guHalf: 30, // gu-level half-year change rate: >=30 deals per half
  dongHalf: 15, // dong-level half-year change rate: >=15 deals per half
  dongBudget: 10, // budget explorer: dong needs >=10 total deals
  jeonseGroupMae: 3, // jeonse ratio group: >=3 매매 deals
  jeonseGroupJeonse: 3, // jeonse ratio group: >=3 전세 deals
  jeonseAreaGroups: 3, // dong/gu jeonse ratio: >=3 matched groups
};

const H1_MONTHS = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'];
const H2_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const ALL_MONTHS = H1_MONTHS.concat(H2_MONTHS);
const H1_SET = new Set(H1_MONTHS);
const H2_SET = new Set(H2_MONTHS);

const AREA_BANDS = ['소형', '중소형', '중형', '대형'];
const HIST_BIN_WIDTH = 5000; // 5,000만원, in 만원 units (matches raw `price` unit)

function areaBand(m2) {
  if (m2 < 60) return '소형';
  if (m2 < 85) return '중소형';
  if (m2 < 102) return '중형';
  return '대형';
}

// ---------------------------------------------------------------------------
// CSV parsing — character-scanning parser, handles quoted fields containing
// commas (e.g. "○○아파트(1,206동)") and escaped quotes ("").
// ---------------------------------------------------------------------------

function forEachCsvRow(text, cb) {
  const len = text.length;
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;

  while (i < len) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34 /* " */) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += text[i];
      i++;
      continue;
    }
    if (c === 34 /* " */) {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === 44 /* , */) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === 13 /* \r */) {
      i++;
      continue;
    }
    if (c === 10 /* \n */) {
      row.push(field);
      field = '';
      cb(row);
      row = [];
      i++;
      continue;
    }
    field += text[i];
    i++;
  }
  // last line without trailing newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    cb(row);
  }
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function roundInt(x) {
  return x === null || x === undefined ? null : Math.round(x);
}

function round1(x) {
  return x === null || x === undefined ? null : Math.round(x * 10) / 10;
}

// ---------------------------------------------------------------------------
// Pass 1: parse CSV, classify rows
// ---------------------------------------------------------------------------

console.log('Reading CSV...');
const csvText = fs.readFileSync(CSV_PATH, 'utf8');

let headerSeen = false;
let expectedCols = 0;
let totalDataRows = 0;
let malformedRows = 0;

const counts = { 매매: 0, 전세: 0, 월세: 0, other: 0 };

// mae (매매) row storage, grouped
const maeByGu = new Map(); // gu -> { price:[], ppp:[], h1:[], h2:[], monthly: Map(ym -> {price:[], ppp:[]}) }
const maeByDong = new Map(); // "gu|dong" -> { gu, dong, price:[], ppp:[], h1:[], h2:[], band: Map(band -> price:[]) }

// jeonse-ratio matching groups: "gu|dong|complex|band" -> { gu, dong, maePrice:[], jeonseDeposit:[] }
const ratioGroups = new Map();

// Seoul-wide monthly
const seoulMonthly = new Map(); // ym -> { price:[], ppp:[] }
for (const ym of ALL_MONTHS) seoulMonthly.set(ym, { price: [], ppp: [] });

function getGuBucket(gu) {
  let b = maeByGu.get(gu);
  if (!b) {
    b = { price: [], ppp: [], h1: [], h2: [], monthly: new Map() };
    for (const ym of ALL_MONTHS) b.monthly.set(ym, { price: [], ppp: [] });
    maeByGu.set(gu, b);
  }
  return b;
}

function getDongBucket(gu, dong) {
  const key = gu + '|' + dong;
  let b = maeByDong.get(key);
  if (!b) {
    b = { gu, dong, price: [], ppp: [], h1: [], h2: [], band: new Map() };
    for (const band of AREA_BANDS) b.band.set(band, { price: [] });
    maeByDong.set(key, b);
  }
  return b;
}

function getRatioGroup(gu, dong, complex_, band) {
  const key = gu + '|' + dong + '|' + complex_ + '|' + band;
  let g = ratioGroups.get(key);
  if (!g) {
    g = { gu, dong, maePrice: [], jeonseDeposit: [] };
    ratioGroups.set(key, g);
  }
  return g;
}

forEachCsvRow(csvText, (row) => {
  if (!headerSeen) {
    headerSeen = true;
    expectedCols = row.length;
    return;
  }
  // skip trailing blank line (if file ends with newline, last cb may fire with single empty field)
  if (row.length === 1 && row[0] === '') return;

  if (row.length !== expectedCols) {
    malformedRows++;
    return;
  }
  totalDataRows++;

  const [
    contract_ym,
    /* contract_date */ ,
    gu,
    dong,
    complex_,
    area_m2_s,
    /* floor */ ,
    deal_type,
    price_s,
    deposit_s,
    /* monthly_rent */ ,
    ppp_s,
  ] = row;

  if (deal_type === '매매') counts['매매']++;
  else if (deal_type === '전세') counts['전세']++;
  else if (deal_type === '월세') counts['월세']++;
  else counts.other++;

  const area_m2 = parseFloat(area_m2_s);
  const band = areaBand(area_m2);

  if (deal_type === '매매') {
    const price = parseFloat(price_s);
    const ppp = parseFloat(ppp_s);
    if (!Number.isFinite(price) || !Number.isFinite(ppp)) return;

    const guB = getGuBucket(gu);
    guB.price.push(price);
    guB.ppp.push(ppp);
    if (H1_SET.has(contract_ym)) guB.h1.push(ppp);
    else if (H2_SET.has(contract_ym)) guB.h2.push(ppp);
    const guMonth = guB.monthly.get(contract_ym);
    if (guMonth) {
      guMonth.price.push(price);
      guMonth.ppp.push(ppp);
    }

    const dongB = getDongBucket(gu, dong);
    dongB.price.push(price);
    dongB.ppp.push(ppp);
    if (H1_SET.has(contract_ym)) dongB.h1.push(ppp);
    else if (H2_SET.has(contract_ym)) dongB.h2.push(ppp);
    dongB.band.get(band).price.push(price);

    const seoulMonth = seoulMonthly.get(contract_ym);
    if (seoulMonth) {
      seoulMonth.price.push(price);
      seoulMonth.ppp.push(ppp);
    }

    const rg = getRatioGroup(gu, dong, complex_, band);
    rg.maePrice.push(price);
  } else if (deal_type === '전세') {
    const deposit = parseFloat(deposit_s);
    if (!Number.isFinite(deposit)) return;
    const rg = getRatioGroup(gu, dong, complex_, band);
    rg.jeonseDeposit.push(deposit);
  }
});

console.log(`Parsed data rows: ${totalDataRows}, malformed: ${malformedRows}`);
console.log('Counts:', counts);

// ---------------------------------------------------------------------------
// Pass 2: jeonse ratio groups -> per-group ratio -> per-dong/gu median
// ---------------------------------------------------------------------------

const dongRatioLists = new Map(); // "gu|dong" -> [ratio, ...]
const guRatioLists = new Map(); // gu -> [ratio, ...]

for (const g of ratioGroups.values()) {
  if (g.maePrice.length < MIN_SAMPLE.jeonseGroupMae) continue;
  if (g.jeonseDeposit.length < MIN_SAMPLE.jeonseGroupJeonse) continue;
  const maeMedian = median(g.maePrice);
  const jeonseMedian = median(g.jeonseDeposit);
  if (!maeMedian) continue;
  const ratio = (jeonseMedian / maeMedian) * 100;

  const dongKey = g.gu + '|' + g.dong;
  if (!dongRatioLists.has(dongKey)) dongRatioLists.set(dongKey, []);
  dongRatioLists.get(dongKey).push(ratio);

  if (!guRatioLists.has(g.gu)) guRatioLists.set(g.gu, []);
  guRatioLists.get(g.gu).push(ratio);
}

function computeJeonseRatio(list) {
  if (!list || list.length < MIN_SAMPLE.jeonseAreaGroups) return null;
  return median(list);
}

// ---------------------------------------------------------------------------
// Build summary.json
// ---------------------------------------------------------------------------

let allMaePrices = [];
let allMaePpp = [];
let allMaeH1 = [];
let allMaeH2 = [];
for (const b of maeByGu.values()) {
  allMaePrices = allMaePrices.concat(b.price);
  allMaePpp = allMaePpp.concat(b.ppp);
  allMaeH1 = allMaeH1.concat(b.h1);
  allMaeH2 = allMaeH2.concat(b.h2);
}

const seoulH1Median = median(allMaeH1);
const seoulH2Median = median(allMaeH2);
const seoulChangeRate =
  seoulH1Median && seoulH2Median ? seoulH2Median / seoulH1Median - 1 : null;

const summaryMonthly = ALL_MONTHS.map((ym) => {
  const m = seoulMonthly.get(ym);
  return {
    ym,
    dealCount: m.price.length,
    medianPricePerPyeong: roundInt(median(m.ppp)),
  };
});

const summary = {
  totalDeals: counts['매매'],
  medianPrice: roundInt(median(allMaePrices)),
  medianPricePerPyeong: roundInt(median(allMaePpp)),
  h1MedianPricePerPyeong: roundInt(seoulH1Median),
  h2MedianPricePerPyeong: roundInt(seoulH2Median),
  changeRate: seoulChangeRate === null ? null : round1(seoulChangeRate * 100),
  monthly: summaryMonthly,
};

// ---------------------------------------------------------------------------
// Build gu.json
// ---------------------------------------------------------------------------

const guNames = Array.from(maeByGu.keys()).sort();
const guOut = guNames.map((gu) => {
  const b = maeByGu.get(gu);
  const h1m = median(b.h1);
  const h2m = median(b.h2);
  const changeRate =
    b.h1.length >= MIN_SAMPLE.guHalf && b.h2.length >= MIN_SAMPLE.guHalf && h1m && h2m
      ? h2m / h1m - 1
      : null;

  const monthly = ALL_MONTHS.map((ym) => {
    const m = b.monthly.get(ym);
    return {
      ym,
      dealCount: m.price.length,
      medianPricePerPyeong: roundInt(median(m.ppp)),
    };
  });

  const jeonseRatio = computeJeonseRatio(guRatioLists.get(gu));

  return {
    gu,
    dealCount: b.price.length,
    medianPrice: roundInt(median(b.price)),
    medianPricePerPyeong: roundInt(median(b.ppp)),
    h1MedianPricePerPyeong: roundInt(h1m),
    h2MedianPricePerPyeong: roundInt(h2m),
    changeRate: changeRate === null ? null : round1(changeRate * 100),
    jeonseRatio: jeonseRatio === null ? null : round1(jeonseRatio),
    monthly,
  };
});

// ---------------------------------------------------------------------------
// Build dong.json
// ---------------------------------------------------------------------------

const dongKeys = Array.from(maeByDong.keys()).sort();
const dongOut = dongKeys.map((key) => {
  const b = maeByDong.get(key);
  const h1m = median(b.h1);
  const h2m = median(b.h2);
  const changeRate =
    b.h1.length >= MIN_SAMPLE.dongHalf &&
    b.h2.length >= MIN_SAMPLE.dongHalf &&
    h1m &&
    h2m
      ? h2m / h1m - 1
      : null;

  const jeonseRatio = computeJeonseRatio(dongRatioLists.get(key));

  const areaBands = {};
  for (const band of AREA_BANDS) {
    const bandData = b.band.get(band);
    const prices = bandData.price;
    if (prices.length === 0) {
      areaBands[band] = { count: 0, median: null, hist: [] };
      continue;
    }
    // sparse histogram: [binIndex, count] pairs, sorted by binIndex.
    // Bins are right-closed (lo, hi]: binIndex bi covers (bi*BIN, (bi+1)*BIN].
    // This matters because 매매 prices cluster hard on exact multiples of
    // HIST_BIN_WIDTH (round-number deals) — a left-closed [lo, hi) bin would
    // put a price exactly at a boundary in the *next* bin, causing the
    // frontend's "budget >= hi ⇒ fully included" logic to wrongly exclude
    // exact-budget matches even though 진입 가능성 is defined as price <= budget.
    const histMap = new Map();
    for (const p of prices) {
      const bin = Math.ceil(p / HIST_BIN_WIDTH) - 1;
      histMap.set(bin, (histMap.get(bin) || 0) + 1);
    }
    const hist = Array.from(histMap.entries()).sort((a, b2) => a[0] - b2[0]);
    areaBands[band] = {
      count: prices.length,
      median: roundInt(median(prices)),
      hist,
    };
  }

  return {
    gu: b.gu,
    dong: b.dong,
    dealCount: b.price.length,
    medianPrice: roundInt(median(b.price)),
    medianPricePerPyeong: roundInt(median(b.ppp)),
    changeRate: changeRate === null ? null : round1(changeRate * 100),
    jeonseRatio: jeonseRatio === null ? null : round1(jeonseRatio),
    areaBands,
  };
});

// ---------------------------------------------------------------------------
// Build meta.json
// ---------------------------------------------------------------------------

const meta = {
  generatedAt: new Date().toISOString(),
  dataPeriod: { start: '2025-07', end: '2026-06', months: 12 },
  totalRows: totalDataRows,
  malformedRows,
  counts: {
    매매: counts['매매'],
    전세: counts['전세'],
    월세: counts['월세'],
  },
  guCount: guOut.length,
  dongCount: dongOut.length,
  minSample: MIN_SAMPLE,
  histBinWidth: HIST_BIN_WIDTH,
  areaBands: {
    소형: '<60㎡',
    중소형: '60~85㎡',
    중형: '85~102㎡',
    대형: '>=102㎡',
  },
  units: {
    price: '만원',
    pricePerPyeong: '만원/평',
    changeRate: '%',
    jeonseRatio: '%',
  },
};

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function writeJson(name, obj) {
  const filePath = path.join(OUT_DIR, name);
  const json = JSON.stringify(obj);
  fs.writeFileSync(filePath, json, 'utf8');
  const size = Buffer.byteLength(json, 'utf8');
  console.log(`${name}: ${(size / 1024).toFixed(1)} KB`);
  return size;
}

let total = 0;
total += writeJson('meta.json', meta);
total += writeJson('summary.json', summary);
total += writeJson('gu.json', guOut);
total += writeJson('dong.json', dongOut);

console.log(`Total payload: ${(total / 1024).toFixed(1)} KB`);
console.log('Done.');
