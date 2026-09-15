import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePage, build, comparePage } from './import-20-120.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'data/source/20_120/2026-09-15');
const baselineFile = path.join(root, 'timetable-data.js');
const html = page => fs.readFileSync(path.join(sourceDir, `${page}.html`), 'utf8');
const at = (trip, stop) => trip.stops.find(s => s.name === stop)?.time;

test('all six sources: 142 trips; independent Sunday data and service notes', () => {
  const { data, comparison } = build(sourceDir, baselineFile);
  assert.deepEqual(data.pages.map(p => p.trips.length), [23, 24, 24, 23, 24, 24]);
  assert.deepEqual(data.pages.map(p => p.trips.reduce((n,t) => n+t.stops.length,0)), [275,312,282,263,291,258]);
  assert.equal(data.serviceDays.holiday, 'sat');
  assert.equal(data.serviceExceptions.obon.serviceDay, 'sun');
  assert.ok(data.pages.every(p => p.effectiveFrom === '2026-04-01' && p.notes.length >= 2));
  for (const page of ['down1','down2','up1','up2']) {
    assert.deepEqual(comparison.pages.find(p => p.page === page).differences, []);
  }
  const sat = data.pages.find(p => p.page === 'down2').trips[0];
  const sun = data.pages.find(p => p.page === 'down3').trips[0];
  assert.equal(at(sat, '安謝橋'), '06:11');
  assert.equal(at(sun, '安謝橋'), '06:01');
  assert.equal(sun.id, '20_120_down3_0');
  assert.ok(comparison.pages.find(p => p.page === 'down3').differences.length > 0);
});

test('weekday first trip: exact boundary times and no out-of-section stops', () => {
  const page = parsePage(html('down1'), 'down1');
  const first = page.trips[0];
  assert.equal(first.route, '20');
  assert.deepEqual(first.stops[0], { name: '那覇BT', time: '05:55' });
  assert.deepEqual(first.stops.at(-1), { name: '安謝橋', time: '06:09' });
  assert.ok(page.trips.every(t => t.stops[0].name === '那覇BT' && t.stops.at(-1).name === '安謝橋'));
});

test('branch-specific 泊高橋 rows keep their own times and stops', () => {
  const trips = parsePage(html('down1'), 'down1').trips;
  assert.equal(trips[0].via, '牧志');
  assert.equal(at(trips[0], '泊高橋'), '06:04');
  assert.equal(at(trips[0], 'タイムス前'), undefined);
  assert.equal(trips[5].via, '久茂地');
  assert.equal(at(trips[5], '泊高橋'), '08:57');
  assert.equal(at(trips[5], '牧志'), undefined);
  assert.ok(trips.every(t => t.stops.filter(s => s.name === '泊高橋').length === 1));
});

test('inbound 120 passes 那覇BT; do not substitute 旭橋 times', () => {
  const trips = parsePage(html('up1'), 'up1').trips;
  assert.ok(trips.filter(t => t.route === '120').every(t => at(t, '那覇BT') === undefined));
  assert.ok(trips.filter(t => t.route === '120').every(t => t.stops.at(-1).name === '旭橋（B）'));
  assert.ok(trips.filter(t => t.route === '20').every(t => at(t, '旭橋（B）') === undefined));
  assert.equal(at(trips[0], '旭橋（B）'), '08:03');
  assert.equal(at(trips[20], '那覇BT'), '20:15');
  assert.equal(trips[0].stops[0].name, '安謝橋');
});

test('stop-time comparison preserves multiplicity, ignoring source-specific trip IDs', () => {
  const row = ['20','06:00','牧志','old_id'];
  const baseline = { outbound: { stops: ['安謝橋'], data: { '安謝橋': { wd: [row, row] } } } };
  const parsed = { page:'down1',direction:'outbound',day:'wd',trips:[{id:'new_id',route:'20',via:'牧志',stops:[{name:'安謝橋',time:'06:00'}]}] };
  const compared = comparePage(parsed, baseline);
  assert.equal(compared.differences[0].removed.length, 1);
  assert.equal(compared.differences[0].added.length, 0);
});

test('wrong day heading, invalid time and lost columns fail closed', () => {
  assert.throws(() => parsePage(html('down2'), 'down3'), /heading mismatch/);
  const original = html('down1');
  assert.throws(() => parsePage(original.replace('<td class="time">555</td>', '<td class="time">599</td>'), 'down1'), /invalid clock time/);
  assert.throws(() => parsePage(original.replace('<td class="time">555</td>', ''), 'down1'), /column count/);
  assert.throws(() => parsePage(original.replace('<td class="stop">天久</td>', '<td class="stop">新停留所</td>'), 'down1'), /unknown stop/);
});

test('conflicting duplicate 泊高橋 times are rejected', () => {
  let seen = 0;
  const changed = html('down1').replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/g, row => {
    if (row.includes('<td class="stop">泊高橋</td>') && ++seen === 2) {
      return row.replace('<td>｜</td>', '<td class="time">605</td>');
    }
    return row;
  });
  assert.throws(() => parsePage(changed, 'down1'), /conflicting duplicate stop/);
});

test('modified source cannot be imported under old provenance metadata', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-source-test-'));
  try {
    fs.cpSync(sourceDir, tmp, { recursive: true });
    fs.appendFileSync(path.join(tmp, 'down1.html'), '\n');
    assert.throws(() => build(tmp, baselineFile), /Source hash mismatch/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
