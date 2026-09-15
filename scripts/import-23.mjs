import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parsePage as parseTable, comparePage } from './import-20-120.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUP = '23_31_223_331';
const PAGES = ['down1', 'down2', 'down3', 'up1', 'up2', 'up3'];
const CONFIG = { group: GROUP, allRoutes: ['23','31','223','331'], routes: ['23'],
  labels: { wd: '平日', sat: '土曜日', sun: '日祝日' },
  noteCodes: ['', 'D', 'a', 'b'], passMarkers: ['｜', '･･･', 'ﾚ'], allowExpress: true, inboundEnd: '旭橋' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function parsePage(html, page) {
  const parsed = parseTable(html, page, CONFIG);
  assert(parsed.notes.some(n => n.includes('a...日曜日運休（祝日運行）') && n.includes('b…日曜日運行（祝日運休）')),
    `${page}: operating-day notes changed; review before importing`);
  assert(parsed.notes.some(n => n.includes('D...基幹急行バス「でいごライナー」')),
    `${page}: express note changed; review before importing`);
  return parsed;
}

export function runsOn(trip, day) {
  // a: 日曜日運休（祝日運行）、b: 日曜日運行（祝日運休）。
  // 土曜日の表にもb列が載るが、曜日の注記に従って除外する。
  if (trip.noteCode === 'a') return day !== 'sun';
  if (trip.noteCode === 'b') return day === 'sun';
  return true;
}

export function build(sourceDir, baselineFile) {
  const { sources } = JSON.parse(fs.readFileSync(path.join(sourceDir, 'source.json'), 'utf8'));
  assert(sources?.length === 6, 'Expected six source records');
  const pages = PAGES.map(page => {
    const matches = sources.filter(s => s.file === `${page}.html`);
    assert(matches.length === 1, `Missing/duplicate source record: ${page}`);
    const source = matches[0], bytes = fs.readFileSync(path.join(sourceDir, source.file));
    assert(bytes.length === source.bytes && hash(bytes) === source.sha256, `Source hash mismatch: ${page}`);
    assert(source.sourceUrl === `https://www.kotsu-okinawa.org/time/${GROUP}/${page}.html`, `Source URL mismatch: ${page}`);
    return { ...parsePage(bytes.toString('utf8'), page), source };
  });
  const schedules = pages.flatMap(page => (page.day === 'sun' ? ['sun', 'holiday'] : [page.day])
    .map(day => ({ page: page.page, direction: page.direction, day,
      trips: page.trips.filter(t => runsOn(t, day)) })));
  const bytes = fs.readFileSync(baselineFile);
  const baseline = vm.runInNewContext(bytes.toString('utf8') + '\nDIRECTIONAL_GTFS', {}, { timeout: 1000 });
  const comparisons = schedules.map(schedule => {
    const result = comparePage({ ...schedule, day: schedule.day === 'holiday' ? 'sun' : schedule.day }, baseline, ['23']);
    return { ...result, day: schedule.day };
  });
  return {
    data: { routes: ['23'], excludedRoutes: ['31','223','331'], section: ['安謝橋', '那覇BT', '旭橋（B）'],
      serviceDays: { weekday:'wd', saturday:'sat', sunday:'sun', holiday:'holiday' },
      serviceNotes: { a:'日曜日運休（祝日運行）', b:'日曜日運行（祝日運休）', D:'基幹急行バス「でいごライナー」' },
      serviceExceptions: { yearEndDates:['12-31','01-01','01-02','01-03'], yearEndDay:'sun',
        obon:{lunarMonth:7,lunarDay:15,serviceDay:'sun'} }, pages, schedules },
    comparison: { baselineFile:path.basename(baselineFile), baselineSha256:hash(bytes), comparisonKey:['route','time','via'], pages:comparisons },
  };
}

export function browserData(data) {
  const directions = { inbound:{}, outbound:{} };
  for (const schedule of data.schedules) {
    const stops = {};
    for (const trip of schedule.trips) {
      for (const stop of trip.stops) {
        const row = [trip.route, stop.time, trip.via, trip.id];
        if (trip.noteCode === 'D') row.push('急行');
        (stops[stop.name] ||= []).push(row);
      }
    }
    directions[schedule.direction][schedule.day] = stops;
  }
  const payload = { routes:data.routes, serviceDays:data.serviceDays,
    retrievedDate:data.pages.map(p=>p.source.retrievedAt.slice(0,10)).sort().at(-1),
    effectiveFrom:[...new Set(data.pages.map(p=>p.effectiveFrom))], directions };
  // One row per stop time keeps generated-file diffs readable.
  const json = JSON.stringify(payload,null,2).replace(/\[\s*("[^"\n]*"(?:,\s*"[^"\n]*")*)\s*\]/g,
    (_, items) => JSON.stringify(JSON.parse('[' + items + ']')));
  return '// scripts/import-23.mjs から生成。23番の安謝橋〜那覇BT・旭橋（B）間。\nconst ROUTE_23 = ' + json + ';\n';
}

export function report(comparison) {
  const labels={wd:'平日',sat:'土曜',sun:'日曜',holiday:'祝日'};
  const lines=['# 23番 抽出・照合結果','','対象は23番の安謝橋〜那覇BT・旭橋（B）間。31・223・331番を除外。既存との比較は系統・時刻・経由で行う。','',
    '| 元ページ | 表示日 | 既存便数 | 抽出便数 | 削除候補（停留所時刻） | 追加候補（停留所時刻） |',
    '| --- | --- | ---: | ---: | ---: | ---: |'];
  for(const p of comparison.pages) lines.push(`| ${p.page} | ${labels[p.day]} | ${p.oldTripCount} | ${p.tripCount} | ${p.differences.reduce((n,d)=>n+d.removed.length,0)} | ${p.differences.reduce((n,d)=>n+d.added.length,0)} |`);
  lines.push('', '## 運行日の注記と急行', '',
    '- a：日曜日運休、祝日運行。土曜は運行。',
    '- b：日曜日運行、祝日運休。土曜の表にも掲載されているが、日曜日運行の注記に従って土曜からは除外。',
    '- 日曜と祝日は同じup3/down3の表を使い、a/bの条件で便を選ぶ。',
    '- D：基幹急行でいごライナー。区間内の停車時刻だけを採用し、通過する安謝橋などに時刻を補わない。画面には「急行」と表示。',
    '- 12月31日〜1月3日と旧暦7月15日のお盆は日曜ダイヤ。画面では手動で日曜を選択。', '', '## 差分の詳細', '');
  for(const p of comparison.pages){
    lines.push(`### ${p.page} / ${labels[p.day]}`, '');
    if(!p.differences.length)lines.push('系統・時刻・経由の差分なし。','');
    for(const d of p.differences){
      lines.push(`- ${d.stop}`);
      for(const r of d.removed)lines.push(`  - 既存のみ：${r[0]}番 ${r[1]} ${r[2]}経由（${r[3]}）`);
      for(const r of d.added)lines.push(`  - 抽出側のみ：${r[0]}番 ${r[1]} ${r[2]}経由（${r[3]}）`);
    }
    lines.push('');
  }
  lines.push('## 表示への利用','','timetable-23.jsに反映。20・120番の生成データは維持し、その他の路線は従来データを利用。','');
  return lines.join('\n');
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  assert(process.argv.length <= 3, 'Usage: node scripts/import-23.mjs [source-directory]');
  const sourceDir=path.resolve(process.argv[2] || path.join(ROOT,`data/source/${GROUP}/2026-09-15`));
  const outputDir=path.join(ROOT,'data/processed/23',path.basename(sourceDir));
  const {data,comparison}=build(sourceDir,path.join(ROOT,'timetable-data.js'));
  fs.mkdirSync(outputDir,{recursive:true});
  fs.writeFileSync(path.join(outputDir,'timetable.json'),JSON.stringify(data,null,2)+'\n');
  fs.writeFileSync(path.join(outputDir,'comparison.json'),JSON.stringify(comparison,null,2)+'\n');
  fs.writeFileSync(path.join(outputDir,'comparison.md'),report(comparison));
  fs.writeFileSync(path.join(ROOT,'timetable-23.js'),browserData(data));
  console.log(JSON.stringify(comparison.pages.map(p=>({page:p.page,day:p.day,trips:p.tripCount,changedStops:p.differences.length})),null,2));
}
