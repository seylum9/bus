import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as build20 } from './import-20-120.mjs';
import { build as build28, parsePage } from './import-28-29.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = path.join(root, 'timetable-data.js');
const dir28 = path.join(root, 'data/source/28_29_228/2026-11-07');
const read = file => fs.readFileSync(file, 'utf8');
const at = (trip, name) => trip.stops.find(s => s.name === name)?.time;

test('October 19 update retains all 250 trips and reproduces both saved extractions', () => {
  const counts = {};
  for (const [source, output, build] of [['20_120','20_120',build20], ['28_29_228','28_29',build28]]) {
    const { data } = build(path.join(root, `data/source/${source}/2026-11-07`), baseline);
    assert.deepEqual(data, JSON.parse(read(path.join(root, `data/processed/${output}/2026-11-07/timetable.json`))));
    for (const page of data.pages) {
      assert.equal(page.effectiveFrom, '2026-10-19');
      for (const trip of page.trips) counts[trip.route] = (counts[trip.route] || 0) + 1;
    }
  }
  assert.deepEqual(counts, {20:24, 120:118, 28:92, 29:16});
});

test('28 weekday 20:30 matches official PDF page 2 column 24, preserving neighboring service', () => {
  const { data } = build28(dir28, baseline);
  const page = data.pages.find(p => p.page === 'down1');
  const trip = page.trips.find(t => t.route === '28' && at(t, '那覇BT') === '20:30');
  assert.equal(trip.via, '牧志');
  assert.deepEqual(trip.stops, [
    ['那覇BT','20:30'], ['県庁北口','20:32'], ['コレクティ','20:36'],
    ['牧志','20:41'], ['安里','20:43'], ['崇元寺','20:45'], ['中之橋','20:46'],
    ['泊高橋','20:48'], ['上之屋','20:51'], ['第一天久','20:52'],
    ['天久','20:53'], ['安謝','20:54'], ['安謝橋','20:55'],
  ].map(([name,time]) => ({name,time})));
  const neighbor = page.trips.find(t => t.route === '28' && at(t, '那覇BT') === '20:15');
  assert.equal(neighbor.via, '久茂地');
  assert.deepEqual(['タイムス前','ラジェ那覇','泊高橋'].map(name => at(neighbor,name)), ['20:20','20:22','20:24']);
  assert.equal(page.corrections.cells.length, 3);
  assert.equal(page.corrections.reference.file, '028_wd_00.pdf');
});

test('official correction cannot silently apply to a different HTML snapshot or altered PDF', () => {
  const html = read(path.join(dir28, 'down1.html'));
  assert.throws(() => parsePage(html + '\n', 'down1'), /conflicting duplicate stop/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-official-reference-'));
  try {
    fs.cpSync(dir28, tmp, {recursive:true});
    fs.appendFileSync(path.join(tmp, '028_wd_00.pdf'), '\n');
    assert.throws(() => build28(tmp, baseline), /Official PDF hash mismatch/);
  } finally { fs.rmSync(tmp, {recursive:true,force:true}); }
});
