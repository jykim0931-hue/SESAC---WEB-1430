#!/usr/bin/env node
'use strict';
/**
 * build/verify.js — acceptance test against PRD §4 verified values.
 *
 * This script independently re-parses seoul-apt-latest.csv (its own copy of
 * the CSV parser + metric logic, not a call into build/aggregate.js) so it
 * is a genuine independent check, and separately spot-checks that
 * data/*.json (the actual shipped output) agrees with those numbers.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'seoul-apt-latest.csv');
const DATA_DIR = path.join(ROOT, 'data');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

// --- CSV parser (independent copy) ---
function forEachCsvRow(text, cb) {
  const len = text.length;
  let i = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  while (i < len) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34) {
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
    if (c === 34) {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === 44) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === 13) {
      i++;
      continue;
    }
    if (c === 10) {
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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    cb(row);
  }
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const H1_SET = new Set(['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']);
const H2_SET = new Set(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);

function bandOf(m2) {
  if (m2 < 60) return '소형';
  if (m2 < 85) return '중소형';
  if (m2 < 102) return '중형';
  return '대형';
}

console.log('Independently re-parsing CSV for verification...');
const csvText = fs.readFileSync(CSV_PATH, 'utf8');

let header = true;
let cols = 0;
let totalRows = 0;
let malformed = 0;
const counts = { 매매: 0, 전세: 0, 월세: 0 };

const maeAll = []; // {gu, dong, complex, band, ym, price, ppp}
const jeonseAll = []; // {gu, dong, complex, band, deposit}

forEachCsvRow(csvText, (row) => {
  if (header) {
    header = false;
    cols = row.length;
    return;
  }
  if (row.length === 1 && row[0] === '') return;
  if (row.length !== cols) {
    malformed++;
    return;
  }
  totalRows++;
  const [ym, , gu, dong, complex_, m2s, , dealType, priceS, depositS, , pppS] = row;
  if (dealType === '매매') counts['매매']++;
  else if (dealType === '전세') counts['전세']++;
  else if (dealType === '월세') counts['월세']++;

  const m2 = parseFloat(m2s);
  const band = bandOf(m2);

  if (dealType === '매매') {
    const price = parseFloat(priceS);
    const ppp = parseFloat(pppS);
    if (!Number.isFinite(price) || !Number.isFinite(ppp)) return;
    maeAll.push({ gu, dong, complex: complex_, band, ym, price, ppp });
  } else if (dealType === '전세') {
    const deposit = parseFloat(depositS);
    if (!Number.isFinite(deposit)) return;
    jeonseAll.push({ gu, dong, complex: complex_, band, deposit });
  }
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}
function approxEqual(actual, expected, tol) {
  if (actual === null || actual === undefined || Number.isNaN(actual)) return false;
  return Math.abs(actual - expected) <= tol;
}

check('320,141 rows parsed, 0 malformed', totalRows === 320141 && malformed === 0, `totalRows=${totalRows} malformed=${malformed}`);
check('총 매매 = 72,459', counts['매매'] === 72459, `actual=${counts['매매']}`);
check('총 전세 = 129,649', counts['전세'] === 129649, `actual=${counts['전세']}`);
check('총 월세 = 118,033', counts['월세'] === 118033, `actual=${counts['월세']}`);

const allMaePrices = maeAll.map((r) => r.price);
check('서울 중위 매매가 = 95,000만원', median(allMaePrices) === 95000, `actual=${median(allMaePrices)}`);

// --- gu change rate (independent recompute) ---
function guChangeRate(guName) {
  const rows = maeAll.filter((r) => r.gu === guName);
  const h1 = rows.filter((r) => H1_SET.has(r.ym)).map((r) => r.ppp);
  const h2 = rows.filter((r) => H2_SET.has(r.ym)).map((r) => r.ppp);
  if (h1.length < 30 || h2.length < 30) return null;
  const m1 = median(h1);
  const m2 = median(h2);
  if (!m1 || !m2) return null;
  return (m2 / m1 - 1) * 100;
}

const guExpected = [
  ['서초구', 21.3],
  ['송파구', 19.7],
  ['용산구', 17.1],
  ['성동구', 16.6],
  ['강남구', 13.9],
  ['서대문구', -9.1],
  ['은평구', -4.8],
  ['양천구', -4.5],
  ['종로구', -3.8],
  ['강북구', -1.3],
];
for (const [name, expected] of guExpected) {
  const actual = guChangeRate(name);
  check(`${name} 변화율 = ${expected >= 0 ? '+' : ''}${expected}%`, approxEqual(actual, expected, 0.2), `actual=${actual === null ? null : actual.toFixed(2)}`);
}

const allGuNames = Array.from(new Set(maeAll.map((r) => r.gu)));
const guComputableCount = allGuNames.filter((g) => guChangeRate(g) !== null).length;
check('25개 구 전부 변화율 산출 가능', guComputableCount === 25, `actual=${guComputableCount} (총 구=${allGuNames.length})`);

// --- dong change rate ---
function dongKey(r) {
  return r.gu + '|' + r.dong;
}
const dongGroups = new Map();
for (const r of maeAll) {
  const k = dongKey(r);
  if (!dongGroups.has(k)) dongGroups.set(k, []);
  dongGroups.get(k).push(r);
}
let dongComputable = 0;
for (const rows of dongGroups.values()) {
  const h1 = rows.filter((r) => H1_SET.has(r.ym)).map((r) => r.ppp);
  const h2 = rows.filter((r) => H2_SET.has(r.ym)).map((r) => r.ppp);
  if (h1.length >= 15 && h2.length >= 15 && median(h1) && median(h2)) dongComputable++;
}
check('211개 동 변화율 산출 가능', dongComputable === 211, `actual=${dongComputable} (총 동=${dongGroups.size})`);

// --- jeonse ratio ---
const ratioGroups = new Map(); // gu|dong|complex|band -> {gu,dong,mae:[],jeonse:[]}
function rgKey(gu, dong, complex_, band) {
  return gu + '|' + dong + '|' + complex_ + '|' + band;
}
for (const r of maeAll) {
  const k = rgKey(r.gu, r.dong, r.complex, r.band);
  if (!ratioGroups.has(k)) ratioGroups.set(k, { gu: r.gu, dong: r.dong, mae: [], jeonse: [] });
  ratioGroups.get(k).mae.push(r.price);
}
for (const r of jeonseAll) {
  const k = rgKey(r.gu, r.dong, r.complex, r.band);
  if (!ratioGroups.has(k)) ratioGroups.set(k, { gu: r.gu, dong: r.dong, mae: [], jeonse: [] });
  ratioGroups.get(k).jeonse.push(r.deposit);
}

const dongRatios = new Map(); // gu|dong -> [ratio,...]
for (const g of ratioGroups.values()) {
  if (g.mae.length < 3 || g.jeonse.length < 3) continue;
  const maeM = median(g.mae);
  const jeonseM = median(g.jeonse);
  const ratio = (jeonseM / maeM) * 100;
  const dk = g.gu + '|' + g.dong;
  if (!dongRatios.has(dk)) dongRatios.set(dk, []);
  dongRatios.get(dk).push(ratio);
}

function dongJeonseRatio(gu, dongName) {
  const list = dongRatios.get(gu + '|' + dongName);
  if (!list || list.length < 3) return null;
  return median(list);
}

check('강남구 압구정동 전세가율 = 16.0%', approxEqual(dongJeonseRatio('강남구', '압구정동'), 16.0, 0.5), `actual=${dongJeonseRatio('강남구', '압구정동')}`);
check('금천구 가산동 전세가율 = 90.5%', approxEqual(dongJeonseRatio('금천구', '가산동'), 90.5, 0.5), `actual=${dongJeonseRatio('금천구', '가산동')}`);

let over100 = 0;
let computableRatioCount = 0;
for (const [dk, list] of dongRatios.entries()) {
  if (list.length < 3) continue;
  const m = median(list);
  computableRatioCount++;
  if (m > 100) over100++;
}
check('전세가율 100% 초과 동 = 0개', over100 === 0, `actual=${over100}`);
check('전세가율 산출 가능 동 = 214개', computableRatioCount === 214, `actual=${computableRatioCount}`);

// --- budget explorer (exact prices, no binning) ---
function budgetEligibleCount(budgetManwon) {
  let n = 0;
  for (const rows of dongGroups.values()) {
    if (rows.length < 10) continue;
    const within = rows.filter((r) => r.price <= budgetManwon).length;
    if (within / rows.length >= 0.3) n++;
  }
  return n;
}
const budgetCases = [
  [50000, 33],
  [80000, 98],
  [100000, 151],
  [150000, 216],
];
for (const [budget, expected] of budgetCases) {
  const actual = budgetEligibleCount(budget);
  check(`예산 ${budget / 10000}억 -> ${expected}개 동`, actual === expected, `actual=${actual}`);
}

// ---------------------------------------------------------------------------
// Cross-check: does the shipped data/*.json agree with this independent calc?
// ---------------------------------------------------------------------------

let jsonCrossCheckPass = true;
const jsonIssues = [];
try {
  const meta = loadJson('meta.json');
  const summary = loadJson('summary.json');
  const guJson = loadJson('gu.json');
  const dongJson = loadJson('dong.json');

  if (meta.counts['매매'] !== counts['매매']) { jsonCrossCheckPass = false; jsonIssues.push('meta 매매 count mismatch'); }
  if (summary.medianPrice !== median(allMaePrices)) { jsonCrossCheckPass = false; jsonIssues.push('summary.medianPrice mismatch'); }

  for (const [name, expected] of guExpected) {
    const g = guJson.find((x) => x.gu === name);
    const indep = guChangeRate(name);
    if (!g || !approxEqual(g.changeRate, indep, 0.05)) {
      jsonCrossCheckPass = false;
      jsonIssues.push(`gu.json ${name} changeRate mismatch (json=${g && g.changeRate}, indep=${indep})`);
    }
  }

  const apg = dongJson.find((d) => d.gu === '강남구' && d.dong === '압구정동');
  const apgIndep = dongJeonseRatio('강남구', '압구정동');
  if (!apg || !approxEqual(apg.jeonseRatio, apgIndep, 0.05)) {
    jsonCrossCheckPass = false;
    jsonIssues.push(`dong.json 압구정동 jeonseRatio mismatch (json=${apg && apg.jeonseRatio}, indep=${apgIndep})`);
  }
} catch (e) {
  jsonCrossCheckPass = false;
  jsonIssues.push('error reading data/*.json: ' + e.message);
}
check('data/*.json 이 독립 재계산 결과와 일치', jsonCrossCheckPass, jsonIssues.join('; ') || 'ok');

// ---------------------------------------------------------------------------
// Histogram exactness: shipped data/dong.json must reproduce the exact
// threshold counts, not the CSV re-parse. Bins are right-closed (lo, hi];
// since budgetCases values are all exact multiples of the 5,000만원 bin
// width, "included" is an exact sum with no interpolation needed.
// ---------------------------------------------------------------------------

const AREA_BAND_NAMES = ['소형', '중소형', '중형', '대형'];
const HIST_BIN = 5000;

function budgetEligibleCountFromDongJson(dongJson, budgetManwon) {
  let n = 0;
  for (const d of dongJson) {
    if (d.dealCount < 10) continue;
    let included = 0;
    for (const band of AREA_BAND_NAMES) {
      const bd = d.areaBands[band];
      if (!bd) continue;
      for (const [idx, c] of bd.hist) {
        const hi = (idx + 1) * HIST_BIN;
        if (hi <= budgetManwon) included += c;
      }
    }
    if (included / d.dealCount >= 0.3) n++;
  }
  return n;
}

try {
  const dongJson = loadJson('dong.json');
  for (const [budget, expected] of budgetCases) {
    const actual = budgetEligibleCountFromDongJson(dongJson, budget);
    check(
      `data/dong.json 히스토그램(정확) 예산 ${budget / 10000}억 -> ${expected}개 동`,
      actual === expected,
      `actual=${actual}`
    );
  }
} catch (e) {
  check('data/dong.json 히스토그램(정확) 검증 실행', false, 'error: ' + e.message);
}

// --- Report ---
console.log('\n=== Verification Report (independent CSV re-parse) ===\n');
let passCount = 0;
for (const r of results) {
  const status = r.pass ? 'PASS' : 'FAIL';
  if (r.pass) passCount++;
  console.log(`[${status}] ${r.name}  (${r.detail})`);
}
console.log(`\n${passCount}/${results.length} checks passed.`);
process.exit(passCount === results.length ? 0 : 1);
