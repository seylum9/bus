import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData } from './import-63.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/source/63_263/2026-09-15');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = page => fs.readFileSync(path.join(dir, `${page}.html`), 'utf8');
const { data, comparison } = build(dir, path.join(root, 'timetable-data.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = vm.createContext({});
for (const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js','timetable-28-29.js','timetable-63.js', 'timetable-32-43-132-143-385.js', 'timetable-52.js','timetable.js'])
  vm.runInContext(read(file), ctx);
const rows = (direction, stop, day) => plain(ctx.getTimetableRows(direction, stop, day)).filter(r => r[0] === '63');

test('six sources contain 77 route 63 trips and match all eight legacy display schedules', () => {
  assert.deepEqual(data.pages.map(p => p.trips.length), [14,12,12,15,12,12]);
  assert.equal(data.schedules.length, 8);
  for (const p of data.pages) {
    assert.equal(p.effectiveFrom, '2026-04-20');
    assert.ok(p.trips.every(t => t.route === '63'));
    assert.equal(new Set(p.trips.map(t => t.id)).size, p.trips.length);
    assert.ok(p.trips.every(t => t.id.endsWith(`_${t.sourceColumn - 1}`)));
  }
  for (const p of comparison.pages) {
    assert.equal(p.oldTripCount, p.tripCount);
    assert.deepEqual(p.differences, []);
    assert.equal(p.outsideScope.length, 0);
  }
});

test('Saturday and Sunday remain separate, and holidays use Sunday source IDs and times', () => {
  for (const direction of ['inbound','outbound']) {
    for (const stop of plain(ctx.getTimetableStops(direction)))
      assert.deepEqual(rows(direction,stop,'sun'), rows(direction,stop,'holiday'));
    assert.notDeepEqual(rows(direction,'安謝橋','sat').map(r => r[1]), rows(direction,'安謝橋','sun').map(r => r[1]));
    assert.ok(rows(direction,'安謝橋','sat').every(r => r[3].includes('2_')));
    assert.ok(rows(direction,'安謝橋','holiday').every(r => r[3].includes('3_')));
  }
  assert.equal(rows('outbound','那覇BT','sat').at(-1)[1], '19:00');
  assert.equal(rows('outbound','那覇BT','holiday').at(-1)[1], '18:30');
  assert.equal(rows('inbound','安謝橋','sat')[0][1], '08:24');
  assert.equal(rows('inbound','安謝橋','holiday')[0][1], '08:22');
  assert.equal(rows('inbound','那覇BT','holiday').at(-1)[1], '20:17');
});

test('all displayed stop times and branch stop order match extraction without excluded routes', () => {
  assert.equal(read('timetable-63.js'), browserData(data));
  assert.deepEqual(data.pages.map(p => p.trips.filter(t => t.via === '牧志').length), [1,0,0,2,1,0]);
  for (const schedule of data.schedules) {
    const stops = plain(ctx.getTimetableStops(schedule.direction));
    for (const trip of schedule.trips) {
      assert.equal(trip.stops[0].name, schedule.direction === 'outbound' ? '那覇BT' : '安謝橋');
      assert.equal(trip.stops.at(-1).name, schedule.direction === 'outbound' ? '安謝橋' : '那覇BT');
      assert.equal(trip.stops.filter(s => s.name === '泊高橋').length, 1);
      assert.equal(trip.stops.some(s => s.name === '牧志'), trip.via === '牧志');
      assert.equal(trip.stops.some(s => s.name === 'タイムス前'), trip.via === '久茂地');
      assert.deepEqual(stops.filter(s => trip.stops.some(t => t.name === s)), trip.stops.map(s => s.name));
    }
    for (const stop of stops) {
      const expected = schedule.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(schedule.direction,stop,schedule.day), expected);
    }
  }
  const trip = data.pages[0].trips.find(t => t.id === '63_263_down1_6');
  assert.deepEqual(['那覇BT','牧志','泊高橋','安謝橋'].map(name => trip.stops.find(s => s.name === name).time),
    ['11:00','11:11','11:17','11:23']);
});

test('missing boundaries, unreviewed notes, wrong days and changed source files are rejected', () => {
  assert.throws(() => parsePage(html('up1').replace('<td class="stop">那覇バスターミナル</td>', '<td class="stop">不明</td>'), 'up1'), /boundary stops/);
  assert.throws(() => parsePage(html('down2').replace('<th></th>', '<th>a</th>'), 'down2'), /trip notes/);
  assert.throws(() => parsePage(html('down2'), 'down3'), /heading mismatch/);
  assert.throws(() => parsePage(html('down2'), 'down4'), /Unknown 63 page/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-63-test-'));
  try {
    fs.cpSync(dir, tmp, { recursive:true });
    fs.appendFileSync(path.join(tmp, 'up3.html'), '\n');
    assert.throws(() => build(tmp, path.join(root, 'timetable-data.js')), /Source hash mismatch/);
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
});
