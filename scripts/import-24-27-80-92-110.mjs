import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parsePage as parseTable, comparePage } from './import-20-120.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUP = '24_27_80_92_93_110_227_777';
const TARGET = '24_27_80_92_110';
const ROUTES = ['24', '27', '80', '92', '110'];
const PAGES = ['down1', 'down2', 'down3', 'up1', 'up2', 'up3'];
const CONFIG = { group: GROUP, allRoutes: ['24','27','80','92','93','110','227','777'], routes: ROUTES,
  labels: { wd: '平日', sat: '土曜', sun: '日祝' }, noteCodes: [''], passMarkers: ['｜', '･･･'], allowExpress: false, inboundEnd: '旭橋' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export const parsePage = (html, page) => parseTable(html, page, CONFIG);

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
  const bytes = fs.readFileSync(baselineFile);
  const baseline = vm.runInNewContext(bytes.toString('utf8') + '\nDIRECTIONAL_GTFS', {}, { timeout: 1000 });
  return {
    data: { routes: ROUTES, excludedRoutes: ['93','227','777'], section: ['安謝橋', '那覇BT', '旭橋（B）'],
      serviceDays: { weekday: 'wd', saturday: 'sat', sunday: 'sun', holiday: 'sun' },
      serviceExceptions: { yearEndDates: ['12-31','01-01','01-02','01-03'], yearEndDay: 'sun',
        obon: { lunarMonth: 7, lunarDay: 15, serviceDay: 'sun' } }, pages },
    comparison: { baselineFile: path.basename(baselineFile), baselineSha256: hash(bytes),
      comparisonKey: ['route','time','via'], pages: pages.map(p => comparePage(p, baseline, ROUTES)) },
  };
}

export function browserData(data) {
  const directions = { inbound: {}, outbound: {} };
  for (const page of data.pages) {
    const stops = {};
    for (const trip of page.trips) for (const stop of trip.stops)
      (stops[stop.name] ||= []).push([trip.route, stop.time, trip.via, trip.id]);
    directions[page.direction][page.day] = stops;
  }
  const payload = { routes: data.routes, serviceDays: data.serviceDays,
    retrievedDate: data.pages.map(p => p.source.retrievedAt.slice(0,10)).sort().at(-1),
    effectiveFrom: [...new Set(data.pages.map(p => p.effectiveFrom))], directions };
  const json = JSON.stringify(payload, null, 2).replace(/\[\s*("[^"\n]*"(?:,\s*"[^"\n]*")*)\s*\]/g,
    (_, items) => JSON.stringify(JSON.parse('[' + items + ']')));
  return '// scripts/import-24-27-80-92-110.mjs から生成。24・27・80・92・110番の安謝橋〜那覇BT・旭橋（B）間。\nconst ROUTE_24_27_80_92_110 = ' + json + ';\n';
}

export function report(comparison) {
  const lines = ['# 24・27・80・92・110番 抽出・照合結果', '',
    '対象は安謝橋〜那覇BT・旭橋（B）間の両方向。93・227・777番を除外。比較は系統・時刻・経由で行う。', '',
    '| 元ページ | 既存便数 | 抽出便数 | 削除候補（停留所時刻） | 追加候補（停留所時刻） |',
    '| --- | ---: | ---: | ---: | ---: |'];
  for (const p of comparison.pages) lines.push(`| ${p.page} | ${p.oldTripCount} | ${p.tripCount} | ${p.differences.reduce((n,d)=>n+d.removed.length,0)} | ${p.differences.reduce((n,d)=>n+d.added.length,0)} |`);
  lines.push('', '## 運行日・経由・停留所', '',
    '- 平日・土曜・日祝の6ページを使用。日曜と祝日は共通。',
    '- 12月31日〜1月3日・旧暦7月15日のお盆は日曜ダイヤ。画面では手動で日曜を選択。',
    '- 土曜・日祝の27番には美栄橋駅前を通る便がある。経由を「美栄橋」とし、久茂地公民館前・美栄橋駅前・牧志公園前の実際の停車時刻を取り込む。',
    '- 通過する牧志・ホテルコレクティブ前などの時刻は補わない。',
    '- 既存データに欠けていた第一天久の時刻を追加。',
    '- この原本では80番は平日の下り1便、92番は日祝の各方向2便。掲載のない曜日・方向には便を追加しない。',
    '- 旭橋（B）の実際の停車時刻を取り込む。那覇BTの欄が通過記号の便に到着時刻を補わない。', '', '## 差分の詳細', '');
  for (const p of comparison.pages) {
    lines.push(`### ${p.page}`, '', `区間外の既存時刻：${p.outsideScope.length}件。`, '');
    if (!p.differences.length) lines.push('系統・時刻・経由の差分なし。', '');
    for (const d of p.differences) {
      lines.push(`- ${d.stop}`);
      for (const row of d.removed) lines.push(`  - 既存のみ：${row[0]}番 ${row[1]} ${row[2]}経由（${row[3]}）`);
      for (const row of d.added) lines.push(`  - 抽出側のみ：${row[0]}番 ${row[1]} ${row[2]}経由（${row[3]}）`);
    }
    lines.push('');
  }
  lines.push('## 表示への利用', '', 'timetable-24-27-80-92-110.jsに反映。比較元のtimetable-data.jsは保持。', '');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 3, 'Usage: node scripts/import-24-27-80-92-110.mjs [source-directory]');
  const sourceDir = path.resolve(process.argv[2] || path.join(ROOT, `data/source/${GROUP}/2026-09-15`));
  const outputDir = path.join(ROOT, 'data/processed', TARGET, path.basename(sourceDir));
  const { data, comparison } = build(sourceDir, path.join(ROOT, 'timetable-data.js'));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'timetable.json'), JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'comparison.md'), report(comparison));
  fs.writeFileSync(path.join(ROOT, 'timetable-24-27-80-92-110.js'), browserData(data));
  console.log(JSON.stringify(comparison.pages.map(p => ({ page:p.page, trips:p.tripCount, changedStops:p.differences.length })), null, 2));
}
