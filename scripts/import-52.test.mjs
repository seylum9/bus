import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData } from './import-52.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/source/52_61/2026-09-15');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = page => fs.readFileSync(path.join(dir, `${page}.html`), 'utf8');
const { data, comparison } = build(dir, path.join(root, 'timetable-data.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = vm.createContext({});
for (const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js','timetable-28-29.js','timetable-63.js','timetable-32-43-132-143-385.js','timetable-52.js','timetable.js'])
  vm.runInContext(read(file), ctx);
const rows = (direction, stop, day) => plain(ctx.getTimetableRows(direction, stop, day)).filter(r => r[0] === '52');
const legacy = plain(vm.runInContext('DIRECTIONAL_GTFS', ctx));

test('six sources retain 90 route 52 trips and fill the missing Daiichi Ameku times', () => {
  assert.deepEqual(data.pages.map(p => p.trips.length), [17,17,11,17,17,11]);
  assert.equal(data.schedules.length, 8);
  for (const p of data.pages) {
    assert.equal(p.effectiveFrom, '2026-04-01');
    assert.ok(p.trips.every(t => t.route === '52'));
    assert.equal(new Set(p.trips.map(t => t.id)).size, p.trips.length);
    assert.ok(p.trips.every(t => t.id.endsWith(`_${t.sourceColumn - 1}`)));
  }
  for (const p of comparison.pages) {
    assert.equal(p.oldTripCount, p.tripCount);
    const stop = p.differences.find(d => d.stop === '第一天久');
    assert.equal(stop.removed.length, 0);
    assert.equal(stop.added.length, p.tripCount);
    assert.equal(p.outsideScope.length, 0);
  }
  assert.equal(rows('outbound','第一天久','wd')[0][1], '06:23');
  assert.equal(rows('inbound','第一天久','wd')[0][1], '07:41');
});

test('22 Miebashi trips use real branch stops; common stop times remain unchanged', () => {
  assert.deepEqual(data.pages.map(p => p.trips.filter(t => t.via === '美栄橋').length), [3,4,5,2,2,6]);
  const addedStops = ['第一天久','久茂地公民館前','美栄橋駅前','牧志公園前'];
  for (const p of data.pages) for (const trip of p.trips) {
    if (trip.via === '美栄橋') {
      assert.ok(addedStops.every(name => trip.stops.some(s => s.name === name)));
      assert.ok(trip.stops.every(s => !['牧志','コレクティ','タイムス前'].includes(s.name)));
      assert.ok(!rows(p.direction,'牧志',p.day).some(r => r[3] === trip.id));
    }
    for (const stop of trip.stops.filter(s => !addedStops.includes(s.name))) {
      const before = legacy[p.direction].data[stop.name]?.[p.day]?.find(r => r[3] === trip.id);
      assert.ok(before, `${trip.id}/${stop.name}`);
      assert.equal(stop.time, before[1]);
      assert.equal(before[2], trip.via === '美栄橋' ? '牧志' : trip.via);
    }
  }
  const trip = data.pages.find(p=>p.page==='up3').trips[0];
  assert.deepEqual(['安謝橋','牧志公園前','美栄橋駅前','久茂地公民館前','那覇BT'].map(name => trip.stops.find(s => s.name === name).time),
    ['07:57','08:10','08:12','08:14','08:24']);
});

test('all displayed rows and trip order match extraction; weekdays, Saturdays and Sundays stay distinct', () => {
  assert.equal(read('timetable-52.js'), browserData(data));
  for (const schedule of data.schedules) {
    const stops = plain(ctx.getTimetableStops(schedule.direction));
    for (const trip of schedule.trips) {
      assert.equal(trip.stops[0].name, schedule.direction === 'outbound' ? '那覇BT' : '安謝橋');
      assert.equal(trip.stops.at(-1).name, schedule.direction === 'outbound' ? '安謝橋' : '那覇BT');
      assert.deepEqual(stops.filter(s => trip.stops.some(t => t.name === s)), trip.stops.map(s => s.name));
    }
    for (const stop of stops) {
      const expected = schedule.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(schedule.direction,stop,schedule.day), expected);
    }
  }
  for (const direction of ['inbound','outbound']) {
    for (const stop of plain(ctx.getTimetableStops(direction)))
      assert.deepEqual(rows(direction,stop,'sun'), rows(direction,stop,'holiday'));
    assert.notDeepEqual(rows(direction,'安謝橋','wd').map(r=>r[1]), rows(direction,'安謝橋','sat').map(r=>r[1]));
    assert.equal(rows(direction,'安謝橋','sat').length, 17);
    assert.equal(rows(direction,'安謝橋','sun').length, 11);
  }
});

test('unreviewed notes, missing boundaries, wrong days and modified sources fail validation', () => {
  assert.throws(() => parsePage(html('up1').replace('<td class="stop">那覇バスターミナル</td>', '<td class="stop">不明</td>'), 'up1'), /boundary stops/);
  assert.throws(() => parsePage(html('down2').replace('<th></th>', '<th>a</th>'), 'down2'), /trip notes/);
  assert.throws(() => parsePage(html('down2'), 'down3'), /heading mismatch/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-52-test-'));
  try {
    fs.cpSync(dir, tmp, { recursive:true });
    fs.appendFileSync(path.join(tmp, 'up3.html'), '\n');
    assert.throws(() => build(tmp, path.join(root, 'timetable-data.js')), /Source hash mismatch/);
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
});
