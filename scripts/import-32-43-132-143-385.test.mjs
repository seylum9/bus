import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData } from './import-32-43-132-143-385.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/source/32_43_132_143_385/2026-09-15');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = page => fs.readFileSync(path.join(dir, `${page}.html`), 'utf8');
const { data, comparison } = build(dir, path.join(root, 'timetable-data.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = vm.createContext({});
for (const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js','timetable-28-29.js','timetable-63.js','timetable-32-43-132-143-385.js', 'timetable-52.js','timetable.js'])
  vm.runInContext(read(file), ctx);
const rows = (direction, stop, day) => plain(ctx.getTimetableRows(direction, stop, day)).filter(r => data.routes.includes(r[0]));
const legacy = plain(vm.runInContext('DIRECTIONAL_GTFS', ctx));

test('six sources preserve all five routes and 123 trips; only 385 differs within scope', () => {
  assert.deepEqual(data.routes, ['32','43','132','143','385']);
  assert.deepEqual(data.pages.map(p => data.routes.map(r => p.trips.filter(t => t.route === r).length)),
    [[4,0,2,8,9],[1,2,0,6,11],[0,3,0,6,10],[2,1,4,7,8],[0,2,1,6,11],[0,2,0,7,10]]);
  assert.equal(data.schedules.length, 8);
  for (const p of data.pages) {
    assert.equal(p.effectiveFrom, '2026-04-01');
    assert.equal(new Set(p.trips.map(t => t.id)).size, p.trips.length);
    assert.ok(p.trips.every(t => t.id.endsWith(`_${t.sourceColumn - 1}`)));
  }
  for (const p of comparison.pages) {
    assert.equal(p.oldTripCount, p.tripCount);
    assert.ok(p.differences.every(d => [...d.removed,...d.added].every(r => r[0] === '385')));
  }
});

test('385 Miebashi branch adds actual stops and removes the mistaken Makishi stop', () => {
  assert.deepEqual(data.pages.map(p => p.trips.filter(t => t.via === '美栄橋').length), [7,10,9,7,10,9]);
  const branchStops = ['久茂地公民館前','美栄橋駅前','牧志公園前'];
  for (const p of data.pages) for (const trip of p.trips) {
    if (trip.via === '美栄橋') {
      assert.equal(trip.route, '385');
      assert.ok(branchStops.every(name => trip.stops.some(s => s.name === name)));
      assert.ok(trip.stops.every(s => !['牧志','コレクティ','タイムス前'].includes(s.name)));
      assert.ok(!rows(p.direction,'牧志',p.day).some(r => r[3] === trip.id));
    }
    for (const stop of trip.stops.filter(s => !branchStops.includes(s.name))) {
      const before = legacy[p.direction].data[stop.name]?.[p.day]?.find(r => r[3] === trip.id);
      assert.ok(before, `${trip.id}/${stop.name}`);
      assert.equal(stop.time, before[1]);
      assert.equal(trip.via, before[2] === '牧志' && trip.via === '美栄橋' ? '美栄橋' : before[2]);
    }
  }
  const out = data.pages[0].trips.find(t => t.id === '32_43_132_143_385_down1_8');
  assert.deepEqual(['那覇BT',...branchStops,'安謝橋'].map(name => out.stops.find(s => s.name === name).time),
    ['10:00','10:04','10:06','10:07','10:22']);
  const into = data.pages[3].trips.find(t => t.id === '32_43_132_143_385_up1_5');
  assert.deepEqual(['安謝橋','牧志公園前','美栄橋駅前','久茂地公民館前','那覇BT'].map(name => into.stops.find(s => s.name === name).time),
    ['10:51','11:01','11:05','11:07','11:15']);
});

test('inbound through services retain Asahibashi times without fabricated Naha BT times', () => {
  for (const p of data.pages) for (const trip of p.trips) {
    if (p.direction === 'outbound') {
      assert.equal(trip.stops[0].name, '那覇BT');
      assert.equal(trip.stops.at(-1).name, '安謝橋');
    } else {
      assert.equal(trip.stops[0].name, '安謝橋');
      assert.equal(trip.stops.at(-1).name, trip.route === '385' ? '那覇BT' : '旭橋（B）');
    }
  }
  for (const day of ['wd','sat','sun','holiday']) {
    assert.ok(rows('inbound','那覇BT',day).every(r => r[0] === '385'));
    assert.equal(rows('inbound','旭橋（B）',day).length, day==='wd'?14:9);
    assert.ok(rows('inbound','旭橋（B）',day).every(r=>r[0]!=='385'));
  }
});

test('all displayed stop times and trip order match extraction; holidays use Sunday', () => {
  assert.equal(read('timetable-32-43-132-143-385.js'), browserData(data));
  for (const schedule of data.schedules) {
    const stops = plain(ctx.getTimetableStops(schedule.direction));
    for (const trip of schedule.trips)
      assert.deepEqual(stops.filter(s => trip.stops.some(t => t.name === s)), trip.stops.map(s => s.name));
    for (const stop of stops) {
      const expected = schedule.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(schedule.direction,stop,schedule.day), expected);
    }
  }
  for (const direction of ['inbound','outbound']) {
    for (const stop of plain(ctx.getTimetableStops(direction)))
      assert.deepEqual(rows(direction,stop,'sun'), rows(direction,stop,'holiday'));
    assert.notDeepEqual(rows(direction,'安謝橋','sat').map(r => r.slice(0,3)), rows(direction,'安謝橋','sun').map(r => r.slice(0,3)));
  }
});

test('unreviewed source changes fail validation', () => {
  assert.throws(() => parsePage(html('down1').replace('<td class="stop">美栄橋駅前</td>', '<td class="stop">不明</td>'), 'down1'), /unknown stop/);
  assert.throws(() => parsePage(html('down2').replace('<th></th>', '<th>a</th>'), 'down2'), /trip notes/);
  assert.throws(() => parsePage(html('down2'), 'down3'), /heading mismatch/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-32-test-'));
  try {
    fs.cpSync(dir, tmp, { recursive:true });
    fs.appendFileSync(path.join(tmp, 'up3.html'), '\n');
    assert.throws(() => build(tmp, path.join(root, 'timetable-data.js')), /Source hash mismatch/);
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
});
