import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCSV } from '../src/data/csv.js';

test('CSV protects formula-like text while preserving negative numeric balances and quoted Unicode fields',()=>{
  const csv=serializeCSV([
    ['Customer','Parts','Balance','Reason'],
    ['=SUM(1,2)','قناة "quoted", brackets',-2,'Line one\nLine two'],
    [' \t+formula','@formula',0,'-text'],
  ]);
  assert.equal(csv,'\uFEFF"Customer","Parts","Balance","Reason"\r\n'+
    '"\'=SUM(1,2)","قناة ""quoted"", brackets","-2","Line one\nLine two"\r\n'+
    '"\' \t+formula","\'@formula","0","\'-text"');
});
