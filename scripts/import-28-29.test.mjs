import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData } from './import-28-29.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/source/28_29_228/2026-09-15');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = page => fs.readFileSync(path.join(dir, `${page}.html`), 'utf8');
const { data, comparison } = build(dir, path.join(root, 'timetable-data.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = vm.createContext({});
for (const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js','timetable-28-29.js', 'timetable-63.js', 'timetable-32-43-132-143-385.js', 'timetable-52.js','timetable.js'])
  vm.runInContext(read(file), ctx);
const rows = (direction, stop, day) => plain(ctx.getTimetableRows(direction, stop, day)).filter(r => ['28','29'].includes(r[0]));

test('four pages retain 108 target trips with source column IDs and match all eight legacy schedules', () => {
  assert.deepEqual(data.pages.map(p => ['28','29'].map(r => p.trips.filter(t => t.route === r).length)),
    [[26,4],[19,5],[26,4],[21,3]]);
  assert.equal(data.schedules.length, 8);
  for (const p of data.pages) {
    assert.equal(p.effectiveFrom, '2026-04-01');
    assert.ok(p.trips.every(t => ['28','29'].includes(t.route)));
    assert.equal(new Set(p.trips.map(t => t.id)).size, p.trips.length);
    assert.ok(p.trips.every(t => t.id.endsWith(`_${t.sourceColumn - 1}`)));
  }
  for (const p of comparison.pages) {
    assert.equal(p.oldTripCount, p.tripCount);
    assert.deepEqual(p.differences, []);
    assert.equal(p.outsideScope.length, 0);
  }
});

test('both directions serve section boundaries and retain branch-specific stops and exact times', () => {
  assert.deepEqual(data.pages.map(p => p.trips.filter(t => t.via === '牧志').length), [11,1,13,3]);
  for (const p of data.pages) for (const trip of p.trips) {
    assert.equal(trip.stops[0].name, p.direction === 'outbound' ? '那覇BT' : '安謝橋');
    assert.equal(trip.stops.at(-1).name, p.direction === 'outbound' ? '安謝橋' : '那覇BT');
    assert.equal(trip.stops.filter(s => s.name === '泊高橋').length, 1);
    assert.equal(trip.stops.some(s => s.name === '牧志'), trip.via === '牧志');
    assert.equal(trip.stops.some(s => s.name === 'タイムス前'), trip.via === '久茂地');
    const uiOrder = plain(ctx.getTimetableStops(p.direction)).filter(s => trip.stops.some(t => t.name === s));
    assert.deepEqual(uiOrder, trip.stops.map(s => s.name));
  }
  const trip = data.pages[0].trips.find(t => t.id === '28_29_228_down1_4');
  assert.equal(trip.route, '29');
  assert.deepEqual(['那覇BT','牧志','泊高橋','安謝橋'].map(name => trip.stops.find(s => s.name === name).time),
    ['07:40','07:48','07:56','08:04']);
  assert.deepEqual(data.pages.map(p => [p.trips[0].stops[0].time, p.trips[0].stops.at(-1).time]),
    [['06:20','06:32'],['07:05','07:15'],['07:02','07:23'],['06:57','07:12']]);
});

test('every displayed row matches the extraction, with identical Saturday, Sunday and holiday service', () => {
  assert.equal(read('timetable-28-29.js'), browserData(data));
  for (const schedule of data.schedules) {
    const stops = plain(ctx.getTimetableStops(schedule.direction));
    assert.ok(schedule.trips.every(t => t.stops.every(s => stops.includes(s.name))));
    for (const stop of stops) {
      const expected = schedule.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(schedule.direction,stop,schedule.day), expected);
    }
  }
  for (const direction of ['inbound','outbound']) for (const stop of plain(ctx.getTimetableStops(direction))) {
    assert.deepEqual(rows(direction,stop,'sat'), rows(direction,stop,'sun'));
    assert.deepEqual(rows(direction,stop,'sat'), rows(direction,stop,'holiday'));
  }
});

test('unreviewed notes, missing boundaries, wrong pages and modified originals are rejected', () => {
  assert.throws(() => parsePage(html('up1').replace('<td class="stop">那覇バスターミナル</td>', '<td class="stop">不明</td>'), 'up1'), /boundary stops/);
  assert.throws(() => parsePage(html('down2').replace('<th></th>', '<th>a</th>'), 'down2'), /trip notes/);
  assert.throws(() => parsePage(html('down2'), 'down1'), /heading mismatch/);
  assert.throws(() => parsePage(html('down2'), 'down3'), /Unknown 28\/29 page/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-28-29-test-'));
  try {
    fs.cpSync(dir, tmp, { recursive:true });
    fs.appendFileSync(path.join(tmp, 'up2.html'), '\n');
    assert.throws(() => build(tmp, path.join(root, 'timetable-data.js')), /Source hash mismatch/);
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
});
