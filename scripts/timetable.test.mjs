import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { browserData } from './import-20-120.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const extracted = JSON.parse(read('data/processed/20_120/2026-11-07/timetable.json'));
const context = vm.createContext({});
for (const file of ['timetable-data.js', 'timetable-20-120.js', 'timetable-23.js', 'timetable-24-27-80-92-110.js', 'timetable-26.js', 'timetable-28-29.js', 'timetable-63.js', 'timetable-32-43-132-143-385.js', 'timetable-52.js', 'timetable.js']) vm.runInContext(read(file), context);
const plain = value => JSON.parse(JSON.stringify(value));
const rows = (direction, stop, day) => plain(context.getTimetableRows(direction, stop, day));
const isTarget = r => ['20', '120'].includes(r[0]);
const legacy = plain(vm.runInContext('DIRECTIONAL_GTFS', context));

test('browser data is exactly the generated extraction', () => {
  assert.equal(read('timetable-20-120.js'), browserData(extracted));
});

test('every displayed 20/120 stop time comes from the correct source page', () => {
  for (const page of extracted.pages) {
    for (const stop of legacy[page.direction].stops) {
      const expected = page.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(page.direction, stop, page.day).filter(isTarget), expected, `${page.page}/${stop}`);
    }
  }
});

test('holiday uses Saturday for 20/120 in both directions', () => {
  for (const direction of ['inbound', 'outbound']) {
    for (const stop of legacy[direction].stops) {
      assert.deepEqual(rows(direction,stop,'holiday').filter(isTarget), rows(direction,stop,'sat').filter(isTarget));
    }
    assert.notDeepEqual(rows(direction,'安謝橋','holiday').filter(isTarget), rows(direction,'安謝橋','sun').filter(isTarget));
  }
});

test('all 18 routes are converted exactly once, with no legacy fallback or out-of-section stops', () => {
  const expectedRoutes = ['20','23','24','26','27','28','29','32','43','52','63','80','92','110','120','132','143','385'];
  const groups = plain(vm.runInContext('TIMETABLE_GROUPS', context));
  assert.deepEqual(groups.flatMap(g=>g.routes).sort((a,b)=>Number(a)-Number(b)), expectedRoutes);
  for (const direction of ['inbound', 'outbound']) {
    assert.equal(plain(context.getTimetableStops(direction)).includes('旭橋（B）'), direction==='inbound');
    for (const stop of legacy[direction].stops) {
      for (const day of ['wd', 'sat', 'sun', 'holiday']) {
        const expected = groups.flatMap(g=>g.directions[direction][day==='holiday'?g.serviceDays.holiday:day]?.[stop] || []);
        assert.deepEqual(rows(direction,stop,day), expected);
      }
    }
  }
  assert.deepEqual(plain(vm.runInContext('DIRECTIONAL_GTFS', context)), legacy);
});

test('page controls render Sunday/holiday schedules and correct trip details', () => {
  const html = read('index.html');
  const elements = new Map();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id, {
    textContent:'', innerHTML:'', hidden:false, classList:{add(){},remove(){}}, scrollIntoView(){}
  });
  const app = vm.createContext({
    document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[],querySelector:()=>null},
    setInterval(){},requestAnimationFrame:fn=>fn()
  });
  for (const [, attrs, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src=attrs.match(/src="\.\/([^"]+)"/)?.[1];
    vm.runInContext(src ? read(src) : code, app);
  }
  assert.ok(elements.has('d5'));
  app.setDirection('outbound', elements.get('d1'));
  app.setStop('安謝橋', elements.get('d1'));
  app.setDay(4, elements.get('d4'));
  assert.equal(vm.runInContext('dayKey()', app), 'sun');
  assert.equal(plain(app.getStopData('安謝橋','sun')).find(r=>r.r==='20').t, '06:01');
  app.selectTrip('20_120_down3_11');
  assert.ok(elements.get('trip-detail').innerHTML.includes('久茂地経由'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('12:03'));
  app.setDay(5, elements.get('d5'));
  assert.equal(vm.runInContext('dayKey()', app), 'holiday');
  assert.equal(plain(app.getStopData('安謝橋','holiday')).find(r=>r.r==='20').t, '06:11');
  assert.equal(vm.runInContext('currentTripId',app), '');
  app.setDirection('inbound', elements.get('d1'));
  app.setDay(4, elements.get('d4'));
  const sunday = plain(app.getStopData('安謝橋','sun'));
  assert.ok(sunday.some(r=>r.r==='120'&&r.t==='08:38'));
  assert.ok(!sunday.some(r=>r.r==='120'&&r.t==='08:21'));
  assert.equal(elements.get('data-footer').textContent, '全18路線：2026-09-15〜2026-11-07取得 / 出典: バスマップ沖縄(kotsu-okinawa.org)');
  app.setDay(3, elements.get('d3'));
  app.selectTrip('24_27_80_92_93_110_227_777_up2_7');
  assert.ok(elements.get('trip-detail').innerHTML.includes('美栄橋経由'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('美栄橋駅前'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('09:42'));
  app.setStop('美栄橋駅前', elements.get('d1'));
  assert.deepEqual(plain(app.getStopData('美栄橋駅前','sat')).filter(r=>r.r==='27').map(r => [r.r,r.t,r.via]), [['27','09:42','美栄橋']]);
  app.setStop('安謝橋', elements.get('d1'));
  app.setDay(5, elements.get('d5'));
  assert.deepEqual(plain(app.getStopData('安謝橋','holiday')).filter(r=>r.r==='26').map(r=>r.t), ['14:51','19:47']);
  app.selectTrip('26_99_up2_7');
  assert.ok(elements.get('trip-detail').innerHTML.includes('県庁北口'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('15:07'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('旭橋（B）'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('15:10'));
  app.selectTrip('28_29_228_up2_3');
  assert.ok(elements.get('trip-detail').innerHTML.includes('牧志経由'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('08:45'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('那覇BT'));
  app.setDirection('outbound', elements.get('d1'));
  app.setDay(1, elements.get('d1'));
  app.selectTrip('28_29_228_down1_4');
  assert.ok(elements.get('trip-detail').innerHTML.includes('29'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('08:05'));
  app.setDay(3, elements.get('d3'));
  assert.equal(plain(app.getStopData('那覇BT','sat')).filter(r=>r.r==='63').at(-1).t, '19:00');
  app.setDay(5, elements.get('d5'));
  assert.equal(plain(app.getStopData('那覇BT','holiday')).filter(r=>r.r==='63').at(-1).t, '18:30');
  app.selectTrip('63_263_down3_11');
  assert.ok(elements.get('trip-detail').innerHTML.includes('18:43'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('安謝橋'));
  app.setDay(1, elements.get('d1'));
  app.selectTrip('32_43_132_143_385_down1_8');
  assert.ok(elements.get('trip-detail').innerHTML.includes('美栄橋経由'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('10:06'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('牧志公園前'));
  app.setDirection('inbound', elements.get('d1'));
  app.setStop('那覇BT', elements.get('d1'));
  assert.ok(plain(app.getStopData('那覇BT','wd')).every(r=>!['32','43','132','143'].includes(r.r)));
  app.setStop('安謝橋', elements.get('d1'));
  app.setDay(5, elements.get('d5'));
  app.selectTrip('52_61_up3_0');
  assert.ok(elements.get('trip-detail').innerHTML.includes('美栄橋経由'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('08:12'));
  assert.ok(elements.get('trip-detail').innerHTML.includes('08:24'));
  assert.ok(!elements.get('data-footer').textContent.includes('その他:'));
  app.setStop('旭橋（B）', elements.get('d1'));
  const asahibashi=plain(app.getStopData('旭橋（B）','holiday'));
  assert.equal(asahibashi.length, 34);
  assert.ok(asahibashi.some(r=>r.r==='26' && r.t==='15:10'));
  assert.ok(elements.get('header-title').textContent.includes('旭橋（B）'));
  app.selectTrip('26_99_up2_7');
  assert.ok(elements.get('trip-detail').innerHTML.includes('15:10'));
  assert.equal(plain(app.getTripStops('26_99_up2_7')).at(-1).stop, '旭橋（B）');

  // 停留所・方向を変更して便を選び直すと、リンク先も選択中の停留所になる。
  function positionStations() {
    return [...elements.get('trip-detail').innerHTML.matchAll(/class="trip-position-link" href="([^"]+)"/g)]
      .map(([,href])=>new URL(href.replaceAll('&amp;','&')).searchParams.get('stationSid'));
  }
  for (const [direction,route,station] of [
    ['inbound','20','77a0c199-9a98-4805-a9c4-f8a521c571a1'],
    ['outbound','80','697fe3e9-4cb9-4079-8b78-694f8dca7247']
  ]) {
    app.setDirection(direction,elements.get('d1'));
    app.setDay(1,elements.get('d1'));
    app.setStop('天久',elements.get('d1'));
    app.selectTrip(app.getStopData('天久','wd').find(t=>t.r===route).trip);
    assert.deepEqual(positionStations(),[station]);
    assert.ok(elements.get('trip-detail').innerHTML.includes('天久を基準'));
    assert.ok(elements.get('trip-detail').innerHTML.includes('target="_blank"'));
  }
  app.setStop('那覇BT',elements.get('d1'));
  app.selectTrip(app.getStopData('那覇BT','wd').find(t=>t.r==='32').trip);
  assert.deepEqual(positionStations(),['8be96447-9358-4269-8e97-3c0ac09677d4','9c114d1b-f99a-4424-b483-e2bb7dd8abd9']);
  const makishi=app.getRoutePositionLinks('23','inbound','泊高橋','牧志');
  const kumoji=app.getRoutePositionLinks('23','inbound','泊高橋','久茂地');
  assert.notEqual(makishi[0].url,kumoji[0].url);
  assert.deepEqual(plain(app.getRoutePositionLinks('20','inbound','未確認の停留所','牧志')),[]);
});
