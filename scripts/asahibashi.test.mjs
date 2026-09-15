import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('all 117 Asahibashi times match their original HTML cells and source columns', () => {
  const groups = ['20_120','23','24_27_80_92_110','26','32_43_132_143_385'];
  let count = 0;
  for (const group of groups) {
    const data = JSON.parse(read(`data/processed/${group}/2026-09-15/timetable.json`));
    for (const page of data.pages.filter(p => p.direction === 'inbound')) {
      const sourceGroup = new URL(page.source.sourceUrl).pathname.split('/')[2];
      const html = read(`data/source/${sourceGroup}/2026-09-15/${page.source.file}`);
      const table = html.match(/<table class="timetable_table">([\s\S]*?)<\/table>/)[1];
      const header = table.match(/<thead>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>/)[1];
      const routes = [...header.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].slice(1).map(m => m[1]);
      const row = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
        .find(m => m[1].includes('<td class="stop">旭橋</td>'))[1];
      const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].slice(3);
      const expected = cells.flatMap((cell, i) => {
        if (!data.routes.includes(routes[i]) || !cell[1].includes('class="time"')) return [];
        const digits = cell[2].trim().padStart(4, '0');
        return [[routes[i], `${digits.slice(0,2)}:${digits.slice(2)}`, i+1]];
      });
      const actual = page.trips.flatMap(trip => trip.stops.filter(s => s.name === '旭橋（B）')
        .map(s => [trip.route,s.time,trip.sourceColumn]));
      assert.deepEqual(actual, expected, `${sourceGroup}/${page.page}`);
      count += actual.length;
      assert.ok(page.trips.every(t => t.stops.every(s => !['公園前','軍桟橋前','那覇空港国内線ターミナル'].includes(s.name))));
    }
  }
  assert.equal(count, 117);
});
