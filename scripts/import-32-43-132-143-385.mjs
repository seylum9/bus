import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parsePage as parseTable, comparePage } from './import-20-120.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['down1', 'down2', 'down3', 'up1', 'up2', 'up3'];
const CONFIG = { group: '32_43_132_143_385', allRoutes: ['32','43','132','143','385'], routes: ['32','43','132','143','385'],
  labels: { wd: '平日', sat: '土曜日', sun: '日祝日' }, noteCodes: [''], passMarkers: ['｜','･･･'],
  allowExpress: false, inboundEnd: '旭橋' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function parsePage(html, page) {
  assert(PAGES.includes(page), `Unknown 32/43/132/143/385 page: ${page}`);
  return parseTable(html, page, CONFIG);
}

export function build(sourceDir, baselineFile) {
  const { sources } = JSON.parse(fs.readFileSync(path.join(sourceDir, 'source.json'), 'utf8'));
  assert(sources?.length === 6, 'Expected six source records');
  const pages = PAGES.map(page => {
    const matches = sources.filter(s => s.file === `${page}.html`);
    assert(matches.length === 1, `Missing/duplicate source record: ${page}`);
    const source = matches[0], bytes = fs.readFileSync(path.join(sourceDir, source.file));
    assert(bytes.length === source.bytes && hash(bytes) === source.sha256, `Source hash mismatch: ${page}`);
    assert(source.sourceUrl === `https://www.kotsu-okinawa.org/time/32_43_132_143_385/${page}.html`, `Source URL mismatch: ${page}`);
    return { ...parsePage(bytes.toString('utf8'), page), source };
  });
  const schedules = pages.flatMap(page => (page.day === 'sun' ? ['sun','holiday'] : [page.day])
    .map(day => ({ page: page.page, direction: page.direction, day, trips: page.trips })));
  const bytes = fs.readFileSync(baselineFile);
  const baseline = vm.runInNewContext(bytes.toString('utf8') + '\nDIRECTIONAL_GTFS', {}, { timeout: 1000 });
  return {
    data: { routes: ['32','43','132','143','385'], excludedRoutes: [], section: ['安謝橋','那覇BT','旭橋（B）'],
      serviceDays: { weekday:'wd', saturday:'sat', sunday:'sun', holiday:'holiday' },
      serviceExceptions: { yearEndDates:['12-31','01-01','01-02','01-03'], yearEndDay:'sun',
        obon:{lunarMonth:7,lunarDay:15,serviceDay:'sun'} },
      pages, schedules },
    comparison: { baselineFile:path.basename(baselineFile), baselineSha256:hash(bytes), comparisonKey:['route','time','via'],
      pages:schedules.map(s => ({ ...comparePage({ ...s, day:s.day === 'holiday' ? 'sun' : s.day }, baseline, ['32','43','132','143','385']), day:s.day })) },
  };
}

export function browserData(data) {
  const directions = { inbound:{}, outbound:{} };
  for (const schedule of data.schedules) {
    const stops = {};
    for (const trip of schedule.trips) for (const stop of trip.stops)
      (stops[stop.name] ||= []).push([trip.route,stop.time,trip.via,trip.id]);
    directions[schedule.direction][schedule.day] = stops;
  }
  const payload = { routes:data.routes, serviceDays:data.serviceDays,
    retrievedDate:data.pages.map(p=>p.source.retrievedAt.slice(0,10)).sort().at(-1),
    effectiveFrom:[...new Set(data.pages.map(p=>p.effectiveFrom))], directions };
  const json = JSON.stringify(payload,null,2).replace(/\[\s*("[^"\n]*"(?:,\s*"[^"\n]*")*)\s*\]/g,
    (_, items) => JSON.stringify(JSON.parse('[' + items + ']')));
  return '// scripts/import-32-43-132-143-385.mjs から生成。32・43・132・143・385番の安謝橋〜那覇BT・旭橋（B）間。\nconst ROUTE_32_43_132_143_385 = ' + json + ';\n';
}

export function report(comparison) {
  const labels = { wd:'平日', sat:'土曜', sun:'日曜', holiday:'祝日' };
  const lines = ['# 32・43・132・143・385番 抽出・照合結果', '',
    '対象は安謝橋〜那覇BT・旭橋（B）間の両方向。5路線すべてを対象とする。系統・時刻・経由で比較し、旭橋（B）も対象区間に含める。', '',
    '| 元ページ | 表示日 | 既存便数 | 抽出便数 | 削除候補（停留所時刻） | 追加候補（停留所時刻） |',
    '| --- | --- | ---: | ---: | ---: | ---: |'];
  for (const p of comparison.pages) lines.push(`| ${p.page} | ${labels[p.day]} | ${p.oldTripCount} | ${p.tripCount} | ${p.differences.reduce((n,d)=>n+d.removed.length,0)} | ${p.differences.reduce((n,d)=>n+d.added.length,0)} |`);
  lines.push('', '## 運行日と区間', '',
    '- 平日・土曜・日祝日の両方向6ページ、計123便。土曜と日祝日は別のページを使い、祝日は日曜と共通。',
    '- 12月31日〜1月3日・旧暦7月15日のお盆は日曜ダイヤ。画面では手動で日曜を選択。',
    '- 安謝橋〜那覇BT・旭橋（B）間の実際の停車時刻を取り込む。牧志・久茂地・美栄橋の経由を便ごとに保持する。',
    '- 385番の美栄橋経由52便（原本6ページ合計）は、既存の牧志表示を美栄橋に修正。牧志の時刻を除き、久茂地公民館前・美栄橋駅前・牧志公園前の時刻を追加する。',
    '- 那覇方面の32・43・132・143番は原本の那覇BT欄が通過記号。旭橋（B）の実際の停車時刻までを取り込み、那覇BTには時刻を補わない。',
    '- 通過する停留所の時刻は補わない。対象区間外の停留所は抽出しない。', '', '## 差分の詳細', '');
  for (const p of comparison.pages) {
    lines.push(`### ${p.page} / ${labels[p.day]}`, '', `区間外の既存時刻：${p.outsideScope.length}件。`, '');
    if (!p.differences.length) lines.push('系統・時刻・経由の差分なし。', '');
    for (const d of p.differences) {
      lines.push(`- ${d.stop}`);
      for (const row of d.removed) lines.push(`  - 既存のみ：${row[0]}番 ${row[1]} ${row[2]}経由（${row[3]}）`);
      for (const row of d.added) lines.push(`  - 抽出側のみ：${row[0]}番 ${row[1]} ${row[2]}経由（${row[3]}）`);
    }
  }
  lines.push('## 表示への利用', '', 'timetable-32-43-132-143-385.jsに反映。比較元のtimetable-data.jsは保持。', '');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 3, 'Usage: node scripts/import-32-43-132-143-385.mjs [source-directory]');
  const sourceDir = path.resolve(process.argv[2] || path.join(ROOT,'data/source/32_43_132_143_385/2026-09-15'));
  const outputDir = path.join(ROOT,'data/processed/32_43_132_143_385',path.basename(sourceDir));
  const { data, comparison } = build(sourceDir,path.join(ROOT,'timetable-data.js'));
  fs.mkdirSync(outputDir,{recursive:true});
  fs.writeFileSync(path.join(outputDir,'timetable.json'),JSON.stringify(data,null,2)+'\n');
  fs.writeFileSync(path.join(outputDir,'comparison.json'),JSON.stringify(comparison,null,2)+'\n');
  fs.writeFileSync(path.join(outputDir,'comparison.md'),report(comparison));
  fs.writeFileSync(path.join(ROOT,'timetable-32-43-132-143-385.js'),browserData(data));
  console.log(JSON.stringify(comparison.pages.map(p=>({page:p.page,day:p.day,trips:p.tripCount,changedStops:p.differences.length})),null,2));
}
