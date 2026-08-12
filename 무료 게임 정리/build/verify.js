// PRD §4에 기획 단계에서 검증해 둔 수치를 data/games.json과 대조한다.
// 실행: node build/verify.js
const assert = require('assert');
const path = require('path');
const d = require(path.join(__dirname, '..', 'data', 'games.json'));

let checked = 0;
const eq = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  checked++;
};

// §3 데이터
eq('총 게임 수', d.meta.totalGames, 328);
eq('깨진 행', d.meta.malformedRows, 0);
eq('중복 title', d.meta.duplicateTitles, 0);
eq('출시일 범위', [d.meta.releaseRange.min, d.meta.releaseRange.max], ['1997-01-07', '2024-06-22']);
eq('출시일 중위', d.meta.releaseRange.medianDate, '2016-05-06');
eq('원본 장르 수', d.meta.genreRawCount, 18);
eq('정제 장르 수', d.meta.genreCount, 12);
eq('기타 묶음', d.meta.otherBucket.n, 5);
eq('기타 구성', d.meta.otherBucket.members.slice().sort(), ['Action', 'Action RPG', 'Fantasy']);
eq('퍼블리셔 수', d.meta.publisherCount, 258);
eq('개발사 수', d.meta.developerCount, 288);
eq('자체 퍼블리싱', d.meta.selfPublished, 207);
eq('브라우저 동시 지원', d.meta.browserGames, 11);
eq('게임 배열 길이', d.games.length, 328);

// §4.1 헤드라인
eq('장르 분포', d.genres.map((g) => [g.genre, g.n]), [
  ['MMORPG', 127], ['Shooter', 93], ['Card Game', 30], ['Strategy', 19], ['MOBA', 18],
  ['Fighting', 9], ['Sports', 9], ['MMO', 6], ['기타', 5], ['Battle Royale', 5],
  ['Social', 4], ['Racing', 3],
]);
eq('장르 합계', d.genres.reduce((s, g) => s + g.n, 0), 328);
eq('TOP2 게임 수', d.headline.top2N, 220);
eq('TOP2 비중', d.headline.top2Share, 67.1);
eq('TOP3 비중', d.headline.top3Share, 76.2);
eq('HHI', d.headline.hhi, 2476);
eq('하위 6개 장르', [d.headline.tailN, d.headline.tailShare], [36, 11]);

// §4.2 출시 시기
const inRange = (a, b) => d.years.filter((y) => y.year >= a && y.year <= b).reduce((s, y) => s + y.n, 0);
eq('연도 범위', [d.years[0].year, d.years[d.years.length - 1].year], [1997, 2024]);
eq('연도 연속성', d.years.length, 28);
eq('1997~2013', inRange(1997, 2013), 100);
eq('2014~2017', inRange(2014, 2017), 108);
eq('2018~2024', inRange(2018, 2024), 120);
eq('2014년', inRange(2014, 2014), 29);
eq('2015년', inRange(2015, 2015), 29);
eq('2024 미완결 표시', d.years[d.years.length - 1].incomplete, true);
eq('마지막 완결 연도', d.meta.lastCompleteYear, 2023);

// §4.3 히트맵
eq('구간 합계', d.eras.map((e) => e.n), [9, 15, 29, 33, 72, 70, 47, 53]);
eq('구간 라벨', d.eras.map((e) => e.label), [
  '1997-2003', '2004-2006', '2007-2009', '2010-2012',
  '2013-2015', '2016-2018', '2019-2021', '2022-2024',
]);
const cellsOf = (g) => d.heatmap.find((h) => h.genre === g).cells;
eq('히트맵 MMORPG', cellsOf('MMORPG'), [8, 13, 19, 21, 21, 25, 6, 14]);
eq('히트맵 Shooter', cellsOf('Shooter'), [0, 0, 6, 8, 27, 21, 15, 16]);
eq('히트맵 Card Game', cellsOf('Card Game'), [0, 0, 0, 0, 6, 13, 5, 6]);
eq('히트맵 Strategy', cellsOf('Strategy'), [0, 0, 1, 1, 4, 2, 8, 3]);
eq('히트맵 MOBA', cellsOf('MOBA'), [0, 0, 1, 1, 4, 6, 2, 4]);
eq('히트맵 Fighting', cellsOf('Fighting'), [0, 0, 1, 1, 3, 1, 2, 1]);
eq('히트맵 행 합계', d.heatmap.every((h) => h.cells.reduce((s, c) => s + c, 0) === h.total), true);

// 시대 교체 — 2014년을 기준으로 1위 장르가 MMORPG에서 Shooter로 바뀐다
const shareIn = (genre, a, b) => {
  const pool = d.games.filter((g) => g.year >= a && g.year <= b);
  return [pool.filter((g) => g.genre === genre).length, pool.length];
};
eq('MMORPG 1997~2013', shareIn('MMORPG', 1997, 2013), [67, 100]);
eq('Shooter 1997~2013', shareIn('Shooter', 1997, 2013), [18, 100]);
eq('MMORPG 2014~2024', shareIn('MMORPG', 2014, 2024), [60, 228]);
eq('Shooter 2014~2024', shareIn('Shooter', 2014, 2024), [75, 228]);
eq('Card Game 2014~2024', shareIn('Card Game', 2014, 2024), [29, 228]);

// §4.4 게임 나이
eq('중위 나이', d.ages.median, 10.3);
eq('평균 나이', d.ages.mean, 10.7);
eq('10년 이상', [d.ages.over10.n, d.ages.over10.share], [173, 52.7]);
eq('15년 이상', [d.ages.over15.n, d.ages.over15.share], [69, 21]);
eq('5년 미만', [d.ages.under5.n, d.ages.under5.share], [55, 16.8]);
eq('나이 빈 합계', d.ages.bins.reduce((s, b) => s + b.n, 0), 328);
eq('기준일', d.meta.refDate, '2026-08-12');

// 게임 레코드 무결성
eq('썸네일 누락', d.games.filter((g) => !g.thumbnail).length, 0);
eq('링크 누락', d.games.filter((g) => !/^https:\/\//.test(g.url)).length, 0);
eq('장르 미분류', d.games.filter((g) => !d.genres.some((x) => x.genre === g.genre)).length, 0);

console.log(`검증 통과 — ${checked}개 항목이 PRD §4 수치와 일치합니다.`);
