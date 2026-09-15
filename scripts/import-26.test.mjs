import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData } from './import-26.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/source/26_99/2026-09-15');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = page => fs.readFileSync(path.join(dir, `${page}.html`), 'utf8');
const { data, comparison } = build(dir, path.join(root, 'timetable-data.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = vm.createContext({});
for (const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js', 'timetable-28-29.js', 'timetable-63.js', 'timetable-32-43-132-143-385.js', 'timetable-52.js','timetable.js'])
  vm.runInContext(read(file), ctx);
const rows = (direction, stop, day) => plain(ctx.getTimetableRows(direction, stop, day)).filter(r => r[0] === '26');

test('four source pages contain fourteen route 26 trips and match legacy data in all eight display schedules', () => {
  assert.deepEqual(data.pages.map(p => p.trips.length), [5,2,5,2]);
  assert.equal(data.schedules.length, 8);
  for (const page of data.pages) {
    assert.equal(page.effectiveFrom, '2026-04-01');
    assert.ok(page.trips.every(t => t.route === '26' && t.via === '久茂地'));
    assert.equal(new Set(page.trips.map(t => t.id)).size, page.trips.length);
    assert.ok(page.trips.every(t => t.id.endsWith(`_${t.sourceColumn - 1}`)));
  }
  for (const p of comparison.pages) {
    assert.equal(p.oldTripCount, p.tripCount);
    assert.deepEqual(p.differences, []);
  }
});

test('actual boundaries and times: outbound serves Naha BT, inbound serves Asahibashi B', () => {
  const outbound = data.pages.find(p => p.page === 'down1').trips[0];
  assert.deepEqual(outbound.stops.map(s => [s.name,s.time]), [
    ['那覇BT','06:45'],['県庁北口','06:48'],['タイムス前','06:50'],['ラジェ那覇','06:51'],
    ['泊高橋','06:53'],['上之屋','06:55'],['第一天久','06:56'],['天久','06:57'],['安謝','06:58'],['安謝橋','06:59'],
  ]);
  assert.deepEqual(rows('inbound','安謝橋','wd').map(r => r[1]), ['07:36','07:50','09:54','11:54','14:17']);
  assert.deepEqual(rows('inbound','県庁北口','wd').map(r => r[1]), ['07:52','08:07','10:08','12:08','14:32']);
  for (const p of data.pages.filter(p => p.direction === 'inbound')) {
    assert.ok(p.trips.every(t => t.stops.at(-1).name === '旭橋（B）'));
    assert.ok(p.trips.every(t => t.stops.length === 10));
  }
  for (const day of ['wd','sat','sun','holiday']) {
    assert.deepEqual(rows('inbound','那覇BT',day), []);
    assert.deepEqual(rows('inbound','旭橋（B）',day).map(r=>r[1]), day==='wd'
      ? ['07:55','08:11','10:12','12:12','14:36'] : ['15:10','20:07']);
  }
});

test('all displayed stops use generated source rows; Saturday, Sunday and holidays are identical', () => {
  assert.equal(read('timetable-26.js'), browserData(data));
  for (const schedule of data.schedules) {
    const stops = plain(ctx.getTimetableStops(schedule.direction));
    assert.ok(schedule.trips.every(t => t.stops.every(s => stops.includes(s.name))));
    for (const stop of stops) {
      const expected = schedule.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(schedule.direction, stop, schedule.day), expected);
    }
  }
  for (const direction of ['inbound','outbound']) for (const stop of plain(ctx.getTimetableStops(direction))) {
    assert.deepEqual(rows(direction,stop,'sat'), rows(direction,stop,'sun'));
    assert.deepEqual(rows(direction,stop,'sat'), rows(direction,stop,'holiday'));
  }
  assert.deepEqual(rows('outbound','那覇BT','holiday').map(r => r[1]), ['10:35','16:07']);
  assert.deepEqual(rows('inbound','安謝橋','holiday').map(r => r[1]), ['14:51','19:47']);
});

test('changed boundaries, unexpected notes, wrong days and source hashes fail validation', () => {
  assert.throws(() => parsePage(html('up1').replace('<td class="stop">旭橋</td>', '<td class="stop">那覇バスターミナル</td>'), 'up1'), /boundary changed/);
  assert.throws(() => parsePage(html('up1').replace('<td class="stop">旭橋</td>', '<td class="stop">不明</td>'), 'up1'), /boundary stops/);
  assert.throws(() => parsePage(html('down2').replace('<th></th>', '<th>a</th>'), 'down2'), /trip notes/);
  assert.throws(() => parsePage(html('down2'), 'down1'), /heading mismatch/);
  assert.throws(() => parsePage(html('down2'), 'down3'), /Unknown 26 page/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-26-test-'));
  try {
    fs.cpSync(dir, tmp, { recursive:true });
    fs.appendFileSync(path.join(tmp, 'up2.html'), '\n');
    assert.throws(() => build(tmp, path.join(root, 'timetable-data.js')), /Source hash mismatch/);
  } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
});
