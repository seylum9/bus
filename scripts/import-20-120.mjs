import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['down1', 'down2', 'down3', 'up1', 'up2', 'up3'];
const DAYS = { '1': 'wd', '2': 'sat', '3': 'sun' };
const LABELS = { wd: '平日', sat: '土曜日・祝日', sun: '日曜日' };
const DEFAULT_CONFIG = { group: '20_120', allRoutes: ['20', '120'], routes: ['20', '120'],
  labels: LABELS, noteCodes: [''], passMarkers: ['｜', '･･･'], allowExpress: false, inboundEnd: '旭橋' };
const ALIASES = {
  '那覇バスターミナル': '那覇BT', '県庁北口': '県庁北口',
  'ホテルコレクティブ前': 'コレクティ', '牧志': '牧志', '安里': '安里',
  '崇元寺': '崇元寺', '中之橋': '中之橋', '泊高橋': '泊高橋',
  '沖縄タイムス前': 'タイムス前', 'ラ・ジェント・ホテル沖縄那覇前': 'ラジェ那覇',
  '上之屋': '上之屋', '第一天久': '第一天久', '天久': '天久',
  '安謝': '安謝', '安謝橋': '安謝橋',
  '旭橋': '旭橋（B）',
  '久茂地公民館前': '久茂地公民館前', '美栄橋駅前': '美栄橋駅前', '牧志公園前': '牧志公園前',
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// These saved pages use simple, closed table rows/cells. Reject structural changes
// instead of guessing column positions or silently dropping unfamiliar values.
function text(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) =>
    String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}
function cells(row) {
  return [...row.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)]
    .map(([, attrs, html]) => ({ attrs, value: text(html) }));
}
const hasClass = (attrs, name) =>
  (attrs.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).includes(name);

export function parsePage(html, page, config = DEFAULT_CONFIG) {
  assert(PAGES.includes(page), `Unknown page: ${page}`);
  const title = 'No.' + config.allRoutes.join(',');
  assert(html.includes(title), `${page}: unexpected route group`);
  const day = DAYS[page.slice(-1)];
  const active = [...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
    .filter(([, attrs]) => hasClass(attrs, 'active'));
  assert(active.length === 1 && active[0][2].includes(`/${config.group}/${page}.html`) &&
    text(active[0][2]) === config.labels[day], `${page}: direction/day heading mismatch`);
  const effective = html.match(new RegExp('No\\.' + config.allRoutes.join(',') + '[^<]*<br>\\s*(\\d{4})/(\\d+)/(\\d+)-'));
  assert(effective, `${page}: missing effective date`);
  const effectiveFrom = `${effective[1]}-${effective[2].padStart(2, '0')}-${effective[3].padStart(2, '0')}`;
  const table = html.match(/<table class="timetable_table">([\s\S]*?)<\/table>/)?.[1];
  assert(table && !/<table\b/i.test(table), `${page}: unsupported table structure`);
  const head = table.match(/<thead>([\s\S]*?)<\/thead>/)?.[1];
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert(head && body, `${page}: missing table head/body`);
  const headers = [...head.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => cells(m[1]));
  assert(headers.length === 2 && headers[0][0].value.includes('系統番号'), `${page}: unexpected headers`);
  const routes = headers[0].slice(1).map(c => c.value);
  assert(routes.length > 0 && routes.every(r => config.allRoutes.includes(r)), `${page}: unexpected route column`);
  assert(headers[1].length === routes.length + 2 && headers[1].slice(2).every(c => config.noteCodes.includes(c.value)),
    `${page}: trip notes require review`);
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m, index) => {
    const row = cells(m[1]);
    assert(row.length === routes.length + 3 && row.every(c => !/\b(?:colspan|rowspan)=/i.test(c.attrs)),
      `${page}: column count/span changed at row ${index + 1}`);
    assert(hasClass(row[2].attrs, 'stop'), `${page}: missing stop column`);
    return { sourceRow: index + 1, sourceName: row[2].value, cells: row.slice(3) };
  });
  const direction = page.startsWith('down') ? 'outbound' : 'inbound';
  const first = direction === 'outbound' ? '那覇バスターミナル' : '安謝橋';
  // 旭橋の掲載がある原本は、確認済みの設定で旭橋（B）まで含める。
  const last = direction === 'outbound' ? '安謝橋' : (config.inboundEnd || '那覇バスターミナル');
  assert(rows.filter(r => r.sourceName === first).length === 1 && rows.filter(r => r.sourceName === last).length === 1,
    `${page}: missing/duplicate boundary stops`);
  const start = rows.findIndex(r => r.sourceName === first), end = rows.findIndex(r => r.sourceName === last);
  assert(start < end, `${page}: invalid stop order`);
  const selected = rows.slice(start, end + 1);
  const trips = routes.flatMap((route, column) => {
    if (!config.routes.includes(route)) return [];
    const noteCode = headers[1][column + 2].value;
    const stops = [];
    for (const row of selected) {
      const cell = row.cells[column];
      if (hasClass(cell.attrs, 'time')) {
        assert(ALIASES[row.sourceName], `${page}: unknown stop inside target section: ${row.sourceName}`);
        assert(/^\d{3,4}$/.test(cell.value), `${page}: invalid time ${cell.value}`);
        const value = cell.value.padStart(4, '0');
        assert(Number(value.slice(0, 2)) < 24 && Number(value.slice(2)) < 60, `${page}: invalid clock time ${value}`);
        const stop = { name: ALIASES[row.sourceName], time: `${value.slice(0, 2)}:${value.slice(2)}` };
        assert(!stops.some(s => s.name === stop.name), `${page}: conflicting duplicate stop ${stop.name}, column ${column + 1}`);
        stops.push(stop);
      } else {
        assert(config.passMarkers.includes(cell.value), `${page}: unrecognized non-stop marker ${cell.value}`);
      }
    }
    assert(stops.some(s => s.name === '安謝橋') || (config.allowExpress && noteCode === 'D' && stops.length >= 2),
      `${page}: trip does not serve 安謝橋`);
    assert(stops.every((s, i) => i === 0 || stops[i - 1].time <= s.time), `${page}: times go backwards`);
    const makishi = stops.some(s => s.name === '牧志'), kumoji = stops.some(s => s.name === 'タイムス前');
    const miebashi = stops.some(s => s.name === '美栄橋駅前');
    assert(Number(makishi) + Number(kumoji) + Number(miebashi) === 1, `${page}: cannot determine via for column ${column + 1}`);
    return [{ id: `${config.group}_${page}_${column}`, route, via: miebashi ? '美栄橋' : makishi ? '牧志' : '久茂地',
      sourceColumn: column + 1, ...(config.allowExpress ? { noteCode } : {}), stops }];
  });
  const notes = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => text(m[1]))
    .filter(s => /日曜日|祝日|12月31日|お盆|でいごライナー/.test(s));
  assert(notes.some(s => s.includes('12月31日') && s.includes('お盆')), `${page}: service exception notes require review`);
  return { page, direction, day, dayLabel: config.labels[day], effectiveFrom, notes, trips };
}

function oldRows(baseline, direction, day, stop, routes) {
  return (baseline[direction].data[stop]?.[day] || []).filter(r => routes.includes(r[0]));
}
const rowKey = row => JSON.stringify(row.slice(0, 3));
function subtract(rows, other) {
  const counts = new Map();
  for (const row of other) counts.set(rowKey(row), (counts.get(rowKey(row)) || 0) + 1);
  return rows.filter(row => {
    const key = rowKey(row), n = counts.get(key) || 0;
    if (n) { counts.set(key, n - 1); return false; }
    return true;
  });
}

export function comparePage(parsed, baseline, routes = ['20', '120']) {
  const { direction, day, trips } = parsed;
  const stops = [...new Set(trips.flatMap(t => t.stops.map(s => s.name)))];
  const differences = [];
  let oldCount = 0, newCount = 0;
  for (const stop of stops) {
    const before = oldRows(baseline, direction, day, stop, routes);
    const after = trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route, s.time, t.via, t.id]));
    const removed = subtract(before, after), added = subtract(after, before);
    oldCount += before.length; newCount += after.length;
    if (removed.length || added.length) differences.push({ stop, removed, added });
  }
  // Include known in-section stops that have disappeared entirely from the new data.
  for (const stop of Object.values(ALIASES).filter(s => !stops.includes(s))) {
    const before = oldRows(baseline, direction, day, stop, routes);
    oldCount += before.length;
    if (before.length) differences.push({ stop, removed: before, added: [] });
  }
  const outsideScope = baseline[direction].stops.filter(s => !Object.values(ALIASES).includes(s))
    .flatMap(stop => oldRows(baseline, direction, day, stop, routes).map(row => ({ stop, row })));
  const oldIds = [...new Set(Object.values(ALIASES).flatMap(stop => oldRows(baseline, direction, day, stop, routes).map(r => r[3])))];
  return { page: parsed.page, direction, day, tripCount: trips.length, oldTripCount: oldIds.length,
    oldStopTimeCount: oldCount, newStopTimeCount: newCount, differences, outsideScope,
    tripIdsOnlyInOld: oldIds.filter(id => !trips.some(t => t.id === id)),
    tripIdsOnlyInNew: trips.filter(t => !oldIds.includes(t.id)).map(t => t.id) };
}

export function build(sourceDir, baselineFile) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'source.json'), 'utf8'));
  assert(manifest.sources?.length === 6, 'Expected six source records');
  const pages = PAGES.map(page => {
    const matches = manifest.sources.filter(s => s.file === `${page}.html`);
    assert(matches.length === 1, `Missing/duplicate source record: ${page}`);
    const source = matches[0], bytes = fs.readFileSync(path.join(sourceDir, source.file));
    assert(bytes.length === source.bytes && sha256(bytes) === source.sha256, `Source hash mismatch: ${page}`);
    assert(source.sourceUrl === `https://www.kotsu-okinawa.org/time/20_120/${page}.html`, `Unexpected source URL: ${page}`);
    return { ...parsePage(bytes.toString('utf8'), page), source };
  });
  const baselineBytes = fs.readFileSync(baselineFile);
  const baseline = vm.runInNewContext(baselineBytes.toString('utf8') + '\nDIRECTIONAL_GTFS', {}, { timeout: 1000 });
  const data = { routes: ['20', '120'], section: ['安謝橋', '那覇BT', '旭橋（B）'],
    serviceDays: { weekday: 'wd', saturday: 'sat', sunday: 'sun', holiday: 'sat' },
    serviceExceptions: { yearEndDates: ['12-31', '01-01', '01-02', '01-03'], yearEndDay: 'sun',
      obon: { lunarMonth: 7, lunarDay: 15, serviceDay: 'sun' } },
    pages };
  const comparison = { baselineFile: path.basename(baselineFile), baselineSha256: sha256(baselineBytes),
    comparisonKey: ['route', 'time', 'via'], pages: pages.map(p => comparePage(p, baseline)) };
  return { data, comparison };
}

export function report(comparison) {
  const lines = ['# 20・120番 抽出・照合結果', '',
    '対象：安謝橋〜那覇バスターミナル・旭橋（B）間の両方向。既存データとの比較は系統・時刻・経由で行い、便IDの違いは別に記録する。', '',
    '| 元ページ | 既存便数 | 抽出便数 | 既存の停留所時刻数 | 抽出した停留所時刻数 | 削除候補 | 追加候補 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const p of comparison.pages) lines.push(`| ${p.page} | ${p.oldTripCount} | ${p.tripCount} | ${p.oldStopTimeCount} | ${p.newStopTimeCount} | ${p.differences.reduce((n,d)=>n+d.removed.length,0)} | ${p.differences.reduce((n,d)=>n+d.added.length,0)} |`);
  lines.push('', '## 曜日と停留所の扱い', '',
    '- 平日・土曜日・日曜日を別ページから抽出。祝日は土曜日のページを使う。',
    '- 原本の注記では12月31日〜1月3日と旧暦7月15日のお盆は日曜ダイヤ。日付からの自動判定は今回実装していない。',
    '- 120番の那覇方面行きは那覇BTの欄が通過記号。到着時刻を補わない。',
    '- 原本の旭橋は旭橋（B）として取り込む。那覇BTと旭橋（B）は別の停留所として保持する。',
    '- 同じ名前の泊高橋の行は、便ごとに時刻がある方を採用。両行に時刻がある場合はエラーにする。',
    '- 表中の各列に便IDを付け、経由ごとに停留所の順番を保持する。', '', '## 差分の詳細', '');
  for (const p of comparison.pages) {
    lines.push(`### ${p.page}`, '', `区間外の既存時刻：${p.outsideScope.length}件。`, '');
    if (!p.differences.length) lines.push('系統・時刻・経由の差分なし。', '');
    for (const d of p.differences) {
      lines.push(`- ${d.stop}`);
      for (const row of d.removed) lines.push(`  - 既存のみ：${row[0]}番 ${row[1]} ${row[2]}経由（${row[3]}）`);
      for (const row of d.added) lines.push(`  - 抽出側のみ：${row[0]}番 ${row[1]} ${row[2]}経由（${row[3]}）`);
    }
    if (p.tripIdsOnlyInNew.length || p.tripIdsOnlyInOld.length) lines.push('',
      `便IDの差分：既存のみ${p.tripIdsOnlyInOld.length}件、抽出側のみ${p.tripIdsOnlyInNew.length}件。これは便の増減を意味せず、上表の時刻差分と分けて確認する。`, '');
  }
  lines.push('## 表示への利用', '', '抽出データは timetable.json、機械可読の差分は comparison.json に保存。timetable-20-120.js を生成し、画面では20・120番の既存データをこの抽出結果で置き換える。他路線は従来の timetable-data.js を使用する。', '');
  return lines.join('\n');
}

export function browserData(data) {
  const directions = { inbound: {}, outbound: {} };
  for (const page of data.pages) {
    const stops = {};
    for (const trip of page.trips) {
      for (const stop of trip.stops) {
        (stops[stop.name] ||= []).push([trip.route, stop.time, trip.via, trip.id]);
      }
    }
    directions[page.direction][page.day] = stops;
  }
  const payload = { routes: data.routes, serviceDays: data.serviceDays,
    retrievedDate: data.pages.map(p => p.source.retrievedAt.slice(0, 10)).sort().at(-1),
    effectiveFrom: [...new Set(data.pages.map(p => p.effectiveFrom))], directions };
  return '// scripts/import-20-120.mjs から生成。20・120番の安謝橋〜那覇BT・旭橋（B）間。\n' +
    'const ROUTE_20_120 = ' + JSON.stringify(payload, null, 2) + ';\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 3, 'Usage: node scripts/import-20-120.mjs [source-directory]');
  const sourceDir = path.resolve(process.argv[2] || path.join(ROOT, 'data/source/20_120/2026-11-07'));
  const outputDir = path.join(ROOT, 'data/processed/20_120', path.basename(sourceDir));
  const { data, comparison } = build(sourceDir, path.join(ROOT, 'timetable-data.js'));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'timetable.json'), JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'comparison.md'), report(comparison));
  fs.writeFileSync(path.join(ROOT, 'timetable-20-120.js'), browserData(data));
  console.log(JSON.stringify(comparison.pages.map(({page, tripCount, differences}) => ({page, tripCount, changedStops: differences.length})), null, 2));
}
