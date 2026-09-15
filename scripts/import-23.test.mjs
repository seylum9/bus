import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build, parsePage, browserData, runsOn } from './import-23.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'data/source/23_31_223_331/2026-09-15');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=page=>fs.readFileSync(path.join(dir,`${page}.html`),'utf8');
const {data,comparison}=build(dir,path.join(root,'timetable-data.js'));
const ctx=vm.createContext({});
for(const file of ['timetable-data.js','timetable-20-120.js','timetable-23.js','timetable-24-27-80-92-110.js','timetable-26.js', 'timetable-28-29.js', 'timetable-63.js', 'timetable-32-43-132-143-385.js', 'timetable-52.js','timetable.js'])vm.runInContext(read(file),ctx);
const rows=(direction,stop,day)=>JSON.parse(JSON.stringify(ctx.getTimetableRows(direction,stop,day))).filter(r=>r[0]==='23');

test('extract only 23, keep source columns, and apply service notes to eight schedules',()=>{
  assert.deepEqual(data.pages.map(p=>p.trips.length),[37,29,29,41,32,32]);
  assert.deepEqual(data.schedules.map(p=>p.trips.length),[37,28,28,28,41,31,31,31]);
  for(const p of data.pages){
    assert.ok(p.trips.every(t=>t.route==='23'));
    assert.ok(p.trips.every(t=>t.id.endsWith(`_${t.sourceColumn-1}`)));
    assert.equal(p.effectiveFrom,'2026-04-01');
    assert.equal(p.trips.filter(t=>t.stops.some(s=>s.name==='旭橋（B）')).length, p.direction==='inbound'?1:0);
  }
  assert.deepEqual(comparison.pages.filter(p=>p.day==='wd').map(p=>p.differences),[[],[]]);
});

test('Sunday/holiday notes are not interchangeable, including Saturday b exclusion',()=>{
  for(const day of ['wd','sat','sun','holiday']){
    assert.equal(runsOn({noteCode:'a'},day),day!=='sun');
    assert.equal(runsOn({noteCode:'b'},day),day==='sun');
    assert.equal(runsOn({noteCode:''},day),true);
  }
  const afternoon=day=>rows('outbound','安謝橋',day).filter(r=>r[1]==='13:49'||r[1]==='13:51').map(r=>r.slice(0,3));
  assert.deepEqual(afternoon('sat'),[['23','13:49','牧志']]);
  assert.deepEqual(afternoon('sun'),[['23','13:51','久茂地']]);
  assert.deepEqual(afternoon('holiday'),[['23','13:49','牧志']]);
  for(const day of ['sat','sun','holiday']){
    const pair=rows('inbound','安謝橋',day).filter(r=>r[1]==='16:28');
    assert.equal(pair.length,1);
    assert.equal(pair[0][2],day==='sun'?'久茂地':'牧志');
  }
});

test('express service only appears at actual served stops, with an express label',()=>{
  const express=data.pages.flatMap(p=>p.trips.filter(t=>t.noteCode==='D'));
  assert.equal(express.length,8);
  assert.ok(express.every(t=>!t.stops.some(s=>s.name==='安謝橋')));
  assert.ok(express.every(t=>t.stops.length===5));
  assert.ok(rows('outbound','那覇BT','wd').some(r=>r[1]==='16:05'&&r[4]==='急行'));
  assert.ok(rows('outbound','上之屋','wd').some(r=>r[1]==='16:17'&&r[4]==='急行'));
  for(const direction of ['outbound','inbound'])assert.ok(rows(direction,'安謝橋','wd').every(r=>r[4]!=='急行'));
});

test('all displayed rows match the extraction without excluded or duplicate routes',()=>{
  assert.equal(read('timetable-23.js'),browserData(data));
  const stops=JSON.parse(vm.runInContext('JSON.stringify(DIRECTIONAL_GTFS)',ctx));
  for(const schedule of data.schedules){
    for(const stop of stops[schedule.direction].stops){
      const expected=schedule.trips.flatMap(t=>t.stops.filter(s=>s.name===stop).map(s=>
        [t.route,s.time,t.via,t.id,...(t.noteCode==='D'?['急行']:[])]));
      assert.deepEqual(rows(schedule.direction,stop,schedule.day),expected);
    }
  }
});

test('unknown note codes, changed note meanings and invalid target stop structure fail',()=>{
  assert.throws(()=>parsePage(html('down2').replace('<th>a</th>','<th>c</th>'),'down2'),/trip notes/);
  assert.throws(()=>parsePage(html('down2').replace('a...日曜日運休（祝日運行）','a...毎日運行'),'down2'),/operating-day notes changed/);
  assert.throws(()=>parsePage(html('up1').replace('<td class="stop">天久</td>','<td class="stop">未対応停留所</td>'),'up1'),/unknown stop/);
  assert.throws(()=>parsePage(html('up1'),'down1'),/heading mismatch/);
});

test('modified source is rejected by hash validation',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bus-23-test-'));
  try{
    fs.cpSync(dir,tmp,{recursive:true});
    fs.appendFileSync(path.join(tmp,'down3.html'),'\n');
    assert.throws(()=>build(tmp,path.join(root,'timetable-data.js')),/Source hash mismatch/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
