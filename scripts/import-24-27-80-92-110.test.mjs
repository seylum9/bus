import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData } from './import-24-27-80-92-110.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/source/24_27_80_92_93_110_227_777/2026-09-15');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { data, comparison } = build(dir, path.join(root, 'timetable-data.js'));
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = vm.createContext({});
for (const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js', 'timetable-28-29.js', 'timetable-63.js', 'timetable-32-43-132-143-385.js', 'timetable-52.js','timetable.js'])
  vm.runInContext(read(file), ctx);
const rows = (direction, stop, day) => plain(ctx.getTimetableRows(direction, stop, day)).filter(r => data.routes.includes(r[0]));

test('six source pages retain only the five requested routes and expected service', () => {
  assert.deepEqual(data.pages.map(p => data.routes.map(r => p.trips.filter(t => t.route === r).length)),
    [[18,16,1,0,18],[7,10,0,0,9],[7,9,0,2,9],[15,17,0,0,19],[10,10,0,0,11],[10,9,0,2,11]]);
  for (const p of data.pages) {
    assert.equal(p.effectiveFrom, '2026-04-01');
    assert.ok(p.trips.every(t => data.routes.includes(t.route)));
    assert.equal(new Set(p.trips.map(t => t.id)).size, p.trips.length);
    assert.ok(p.trips.every(t => t.id.endsWith(`_${t.sourceColumn - 1}`)));
  }
  for (const p of comparison.pages) {
    assert.equal(p.oldTripCount, p.tripCount);
    const added = p.differences.find(d => d.stop === '第一天久');
    assert.equal(added.removed.length, 0);
    assert.equal(added.added.length, p.tripCount);
  }
  assert.deepEqual(comparison.pages.filter(p => p.day === 'wd').map(p => p.differences.map(d => d.stop)),
    [['第一天久'], ['第一天久']]);
});

test('27 uses the actual Miebashi branch and never invents Makishi stops', () => {
  const expected = {
    down2: ['12:40','12:43','12:44','12:46','13:04'],
    down3: ['12:10','12:13','12:14','12:16','12:34'],
    up2: ['09:25','09:40','09:42','09:45','09:55'],
    up3: ['09:48','10:01','10:02','10:04','10:14'],
  };
  for (const page of data.pages.filter(p => p.day !== 'wd')) {
    const branch = page.trips.filter(t => t.via === '美栄橋');
    assert.equal(branch.length, 1);
    const trip = branch[0];
    assert.equal(trip.route, '27');
    const names = page.direction === 'outbound'
      ? ['那覇BT','久茂地公民館前','美栄橋駅前','牧志公園前','安謝橋']
      : ['安謝橋','牧志公園前','美栄橋駅前','久茂地公民館前','那覇BT'];
    assert.deepEqual(names.map(name => trip.stops.find(s => s.name === name).time), expected[page.page]);
    assert.ok(trip.stops.every(s => !['牧志','コレクティ','タイムス前'].includes(s.name)));
    assert.ok(!rows(page.direction, '牧志', page.day).some(r => r[3] === trip.id));
    const uiOrder = plain(ctx.getTimetableStops(page.direction)).filter(s => trip.stops.some(t => t.name === s));
    assert.deepEqual(uiOrder, trip.stops.map(s => s.name));
  }
});

test('every displayed row, including added stops and holidays, matches source extraction exactly', () => {
  assert.equal(read('timetable-24-27-80-92-110.js'), browserData(data));
  for (const p of data.pages) {
    const stops = plain(ctx.getTimetableStops(p.direction));
    assert.ok(p.trips.every(t => t.stops.every(s => stops.includes(s.name))));
    for (const stop of stops) {
      const expected = p.trips.flatMap(t => t.stops.filter(s => s.name === stop).map(s => [t.route,s.time,t.via,t.id]));
      assert.deepEqual(rows(p.direction, stop, p.day), expected, `${p.page}/${stop}`);
      if (p.day === 'sun') assert.deepEqual(rows(p.direction, stop, 'holiday'), expected);
    }
  }
  assert.deepEqual(rows('outbound','那覇BT','wd').filter(r => r[0] === '80').map(r => r[1]), ['11:50']);
  assert.deepEqual(rows('inbound','安謝橋','holiday').filter(r => r[0] === '92').map(r => r[1]), ['16:43','19:53']);
});

test('new source notes, unknown branch stops and modified files are rejected', () => {
  const html = fs.readFileSync(path.join(dir, 'down2.html'), 'utf8');
  assert.throws(() => parsePage(html.replace('<th></th>', '<th>a</th>'), 'down2'), /trip notes/);
  assert.throws(() => parsePage(html.replace('<td class="stop">美栄橋駅前</td>', '<td class="stop">未対応停留所</td>'), 'down2'), /unknown stop/);
  assert.throws(() => parsePage(html, 'down3'), /heading mismatch/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-24-test-'));
  try {
    fs.cpSync(dir, tmp, { recursive: true });
    fs.appendFileSync(path.join(tmp, 'up3.html'), '\n');
    assert.throws(() => build(tmp, path.join(root, 'timetable-data.js')), /Source hash mismatch/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
