import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataService } from '../src/data/service.js';
import { createPendingJournal } from '../src/data/pendingRequests.js';
import { inspectLegacyStorage, legacyBackup } from '../src/data/localStorageAdapter.js';
import { requireQuantity, dateOf, trackerError } from '../src/data/mutations.js';

function storage() {
  const values = new Map();
  return { values, getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
}
function fixture(operation = async () => ({ id:'b' })) {
  const local = storage();
  local.setItem('hdg_batches_v4', '[{"id":"old"}]');
  const journal = createPendingJournal(local,'demo-aete','user');
  let update, fail, verified = true;
  const calls = [];
  const service = createDataService({ journal, getSession:()=>({ permissionsVerified:verified }), adapter:{
    subscribe(next,error) { update = next; fail = error; return ()=>{}; },
    async receiveBatch(input) { calls.push(input); return operation(input); },
  }});
  service.subscribe(()=>{});
  return {service, journal, local, calls, connect:()=>update({batches:[],roster:[],activity:[]},{connected:true,error:null}),
    offline:()=>update(null,{connected:false,error:null}), fail, unverify:()=>{verified=false;} };
}

test('legacy backup preserves exact records, including malformed JSON, without overwriting storage',()=>{
  const local=storage(); local.setItem('hdg_batches_v4','not JSON'); local.setItem('hdg_roster_v4','[{"name":"Old"}]');
  const before=new Map(local.values); const legacy=inspectLegacyStorage(local);
  assert.equal(legacy.present,true); assert.equal(legacy.counts.batches,null); assert.equal(legacy.counts.roster,1);
  assert.deepEqual(JSON.parse(legacyBackup(legacy)).records,Object.fromEntries(before)); assert.deepEqual(local.values,before);
  const blocked=inspectLegacyStorage({getItem(){throw Error('blocked');}});
  assert.equal(blocked.available,false); assert.throws(()=>legacyBackup(blocked),/could not be read/);
});

test('shared service rejects disconnected or unverified saves and never falls back to old browser records',async()=>{
  const h=fixture(); const before=new Map(h.local.values);
  await assert.rejects(h.service.receiveBatch({id:'b'}),{code:'offline'});
  h.connect(); h.unverify(); await assert.rejects(h.service.receiveBatch({id:'b'}),{code:'offline'});
  h.fail(Error('denied')); assert.equal(h.service.status.connected,false); assert.equal(h.service.status.kind,'firebase');
  assert.equal(h.calls.length,0); assert.deepEqual(h.local.values,before);
});

test('uncertain save survives reload, blocks a different action, and retries the original request explicitly',async()=>{
  let uncertain=true;
  const h=fixture(async()=>{if(uncertain) throw trackerError('save-unconfirmed','lost response',true); return {id:'b',replayed:true};});
  h.connect(); const input={id:'b',mutationId:'event',piecesIn:'10'};
  await assert.rejects(h.service.receiveBatch(input),{code:'save-unconfirmed'});
  assert.deepEqual(h.journal.current.input,input);
  const restored=createPendingJournal(h.local,'demo-aete','user'); assert.deepEqual(restored.current,h.journal.current);
  assert.equal(createPendingJournal(h.local,'demo-aete','other').current,null);
  assert.equal(createPendingJournal(h.local,'other-project','user').current,null);
  await assert.rejects(h.service.receiveBatch({...input,mutationId:'new'}),{code:'pending-request'});
  assert.equal(h.calls.length,1); uncertain=false;
  assert.equal((await h.service.retryPending()).replayed,true);
  assert.deepEqual(h.calls,[input,input]); assert.equal(h.journal.current,null);
  assert.equal(h.local.getItem('hdg_batches_v4'),'[{"id":"old"}]');
});

test('single-flight save blocks double clicks and definitive rejection clears the journal',async()=>{
  let finish;
  const h=fixture(()=>new Promise((resolve,reject)=>{finish=reject;})); h.connect();
  const first=h.service.receiveBatch({id:'b'});
  assert.equal(h.service.status.busy,true);
  await assert.rejects(h.service.receiveBatch({id:'b'}),{code:'busy'});
  finish(trackerError('invalid-staff','staff disabled'));
  await assert.rejects(first,{code:'invalid-staff'});
  assert.equal(h.journal.current,null); assert.equal(h.service.status.busy,false);
});

test('blocked journal storage retains retry protection within the current page',()=>{
  const journal=createPendingJournal({getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}},'demo','u');
  journal.remember('receiveBatch',{id:'b'}); assert.equal(journal.current.input.id,'b');
  assert.throws(()=>journal.remember('receiveBatch',{id:'other'}),{code:'pending-request'}); journal.clear(); assert.equal(journal.current,null);
});

test('quantities reject blank, negative, fractional pieces, nonfinite and out-of-range inputs; timestamps support Firestore',()=>{
  for(const value of ['', ' ',null,true,-1,'Infinity',NaN,1e9+1,1.5]) assert.throws(()=>requireQuantity(value,'Pieces',true),{code:'invalid-input'});
  assert.equal(requireQuantity('0','Pieces',true),0); assert.equal(requireQuantity('123.45','Weight'),123.45);
  assert.throws(()=>requireQuantity(1e12+1,'Weight'),{code:'invalid-input'});
  const date=new Date('2026-01-01T00:00:00Z'); assert.equal(dateOf({toDate:()=>date}),date); assert.equal(dateOf('bad'),null);
});
