import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, terminate, doc, getDocFromServer, getDocsFromServer, collection, query, where, disableNetwork, enableNetwork } from 'firebase/firestore';
import { createFirebaseAdapter } from '../src/data/firebaseAdapter.js';
import { createDataService } from '../src/data/service.js';
import { createPendingJournal } from '../src/data/pendingRequests.js';
import { trackerError } from '../src/data/mutations.js';

const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST;
const waitFor=async(predicate,label)=>{
  const deadline=Date.now()+12000;
  while(!predicate()) { assert.ok(Date.now()<deadline,`Timed out: ${label}`); await new Promise(resolve=>setTimeout(resolve,40)); }
};

test('Phase 4 shared adapter with real authenticated clients and deployed emulator rules', {skip:!authHost||!firestoreHost,timeout:90000}, async(t)=>{
  const prefix=`data_${Date.now()}`; const clients=[]; const stops=[];
  async function profile(uid,role,active=true){
    const response=await fetch(`http://${firestoreHost}/v1/projects/demo-aete/databases/(default)/documents/users/${uid}`,{
      method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},
      body:JSON.stringify({fields:{role:{stringValue:role},active:{booleanValue:active}}}),
    }); assert.equal(response.ok,true,await response.text());
  }
  async function client(role){
    const app=initializeApp({projectId:'demo-aete',apiKey:'demo-key'},`${prefix}_${role}`);
    const auth=initializeAuth(app,{persistence:inMemoryPersistence}); connectAuthEmulator(auth,`http://${authHost}`,{disableWarnings:true});
    const db=getFirestore(app); const [host,port]=firestoreHost.split(':'); connectFirestoreEmulator(db,host,Number(port));
    const user=(await createUserWithEmailAndPassword(auth,`${prefix}_${role}@example.test`,'emulator-only-pass')).user;
    await profile(user.uid,role); const c={app,auth,db,uid:user.uid,online:true,data:null,status:null}; clients.push(c);
    c.adapter=createFirebaseAdapter({client:c,expectedUid:c.uid,isOnline:()=>c.online});
    c.service=createDataService({adapter:c.adapter,journal:createPendingJournal(null,'demo-aete',c.uid)});
    stops.push(c.service.subscribe((data,status)=>{c.data=data;c.status=status;}));
    await waitFor(()=>c.status?.connected,`${role} connected`); return c;
  }
  try {
    const manager=await client('manager'), plant=await client('plant'), shiftA=await client('shiftA'), shiftB=await client('shiftB');
    const staff={plant:`${prefix}_plant`,shiftA:`${prefix}_a`,shiftB:`${prefix}_b`};
    await t.test('live roster writes use the exact server schema and are shared across independent clients',async()=>{
      for(const [key,role] of [['plant','Plant Supervisor'],['shiftA','Shift A Supervisor'],['shiftB','Shift B Supervisor']]) {
        await manager.service.addStaff({id:staff[key],name:`Tester ${key}`,role});
      }
      await waitFor(()=>plant.data.roster.some(s=>s.id===staff.shiftB),'plant receives live roster');
      const saved=(await getDocFromServer(doc(manager.db,'roster',staff.plant))).data();
      assert.deepEqual(Object.keys(saved).sort(),['active','id','name','role','shift']); assert.equal(saved.shift,'Plant');
      await assert.rejects(plant.adapter.addStaff({id:`${prefix}_denied`,name:'No',role:'Plant Supervisor'}),{code:'access-denied'});
    });
    const receive={id:`${prefix}_batch`,mutationId:`${prefix}_receive`,jobNo:'JC-PHASE4',customer:'Shared test',parts:'Cable tray',piecesIn:'10',weightIn:'125.5',staffId:staff.plant};
    await t.test('received batch and immutable receipt commit together, live read reflects server timestamps, and duplicate retry has one event',async()=>{
      await plant.service.receiveBatch(receive);
      await waitFor(()=>shiftA.data.batches.some(b=>b.id===receive.id),'shift receives live batch');
      const b=shiftA.data.batches.find(b=>b.id===receive.id); assert.equal(b.version,1); assert.equal(b.receivedUid,plant.uid);
      assert.equal(typeof b.receivedAt.toDate,'function'); assert.equal(b.piecesIn,10);
      assert.equal((await plant.adapter.receiveBatch(receive)).replayed,true);
      const events=await getDocsFromServer(query(collection(manager.db,'activity'),where('batchId','==',receive.id)));
      assert.equal(events.size,1); assert.deepEqual(events.docs[0].data().snapshot,b);
      await assert.rejects(plant.adapter.receiveBatch({...receive,customer:'Changed'}),{code:'already-saved'});
    });
    const process={id:receive.id,mutationId:`${prefix}_process`,expectedStatus:'Received',expectedVersion:1,staffId:staff.shiftA};
    await t.test('staged workflow supports cross-shift handoff, mismatched quantities and old receipt replay after later stages',async()=>{
      await shiftA.service.transitionBatch(process);
      await assert.rejects(shiftB.adapter.transitionBatch({...process,mutationId:`${prefix}_stale`,staffId:staff.shiftB}),{code:'conflict'});
      await shiftB.service.transitionBatch({id:receive.id,mutationId:`${prefix}_ready`,expectedStatus:'Processing',expectedVersion:2,staffId:staff.shiftB,piecesOut:'9',weightOut:'120.25'});
      await plant.service.transitionBatch({id:receive.id,mutationId:`${prefix}_dispatch`,expectedStatus:'Ready',expectedVersion:3,staffId:staff.plant});
      assert.equal((await shiftA.adapter.transitionBatch(process)).replayed,true);
      assert.equal((await plant.adapter.receiveBatch(receive)).replayed,true);
      const b=(await getDocFromServer(doc(manager.db,'batches',receive.id))).data();
      assert.equal(b.version,4); assert.equal(b.status,'Dispatched'); assert.equal(b.readyShift,'Shift B'); assert.equal(b.piecesOut,9);
      const events=await getDocsFromServer(query(collection(manager.db,'activity'),where('batchId','==',receive.id)));
      assert.equal(events.size,4);
    });
    await t.test('archive keeps all history and deleting staff retains historical names and account attribution',async()=>{
      await manager.service.archiveBatch({id:receive.id,mutationId:`${prefix}_archive`,expectedStatus:'Dispatched',expectedVersion:4,reason:'Completed test'});
      await waitFor(()=>plant.data.batches.find(b=>b.id===receive.id)?.archived,'archive visible across clients');
      const current=(await getDocFromServer(doc(manager.db,'roster',staff.shiftA))).data();
      await manager.service.setStaffActive({id:staff.shiftA,expected:current,active:false});
      await manager.service.removeStaff({id:staff.shiftA,expected:{...current,active:false}});
      let history; stops.push(manager.adapter.subscribeHistory(receive.id,(entries,cache)=>{if(!cache)history=entries;},e=>{throw e;}));
      await waitFor(()=>history?.length===5,'full archived history');
      assert.deepEqual(history.map(e=>e.action),['Received','Into process','Ready','Dispatched','Archived']);
      assert.equal(history[1].who,'Tester shiftA'); assert.equal(history[1].actorUid,shiftA.uid); assert.equal(history[4].snapshot.archiveReason,'Completed test');
      await assert.rejects(manager.adapter.archiveBatch({id:receive.id,mutationId:`${prefix}_rearchive`,expectedStatus:'Dispatched',expectedVersion:5,reason:'Again'}),{code:'conflict'});
    });
    await t.test('two independent supervisors racing from one version produce one stage change and one activity event',async()=>{
      await manager.service.addStaff({id:staff.shiftA,name:'Tester shiftA',role:'Shift A Supervisor'});
      const batch={...receive,id:`${prefix}_race`,mutationId:`${prefix}_race_receive`}; await plant.service.receiveBatch(batch);
      const results=await Promise.allSettled([shiftA.adapter.transitionBatch({id:batch.id,mutationId:`${prefix}_race_a`,expectedVersion:1,expectedStatus:'Received',staffId:staff.shiftA}),shiftB.adapter.transitionBatch({id:batch.id,mutationId:`${prefix}_race_b`,expectedVersion:1,expectedStatus:'Received',staffId:staff.shiftB})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(results.find(r=>r.status==='rejected').reason.code,'conflict');
      assert.equal((await getDocFromServer(doc(manager.db,'batches',batch.id))).data().version,2);
      assert.equal((await getDocsFromServer(query(collection(manager.db,'activity'),where('batchId','==',batch.id)))).size,2);
    });
    await t.test('lost confirmation survives service reload and retries the original receipt after another client advances the batch',async()=>{
      const values=new Map();
      const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
      const request={...receive,id:`${prefix}_uncertain`,mutationId:`${prefix}_uncertain_receive`};
      const lostConfirmationAdapter={
        ...plant.adapter,
        async receiveBatch(input) {
          await plant.adapter.receiveBatch(input);
          // Simulate losing only the acknowledgement, after a real atomic commit.
          throw trackerError('unconfirmed','Save acknowledgement was lost.',true);
        },
      };
      const original=createDataService({adapter:lostConfirmationAdapter,journal:createPendingJournal(storage,'demo-aete',plant.uid)});
      const stop=original.subscribe(()=>{}); stops.push(stop);
      await waitFor(()=>original.status.connected,'uncertain service connected');
      await assert.rejects(original.receiveBatch(request),{code:'unconfirmed',uncertain:true});
      assert.deepEqual(original.status.pendingRequest.input,request);
      await assert.rejects(original.receiveBatch({...request,id:`${prefix}_second`}),{code:'pending-request'});
      stop();
      await shiftA.service.transitionBatch({id:request.id,mutationId:`${prefix}_uncertain_process`,expectedVersion:1,expectedStatus:'Received',staffId:staff.shiftA});
      const reloaded=createDataService({adapter:plant.adapter,journal:createPendingJournal(storage,'demo-aete',plant.uid)});
      stops.push(reloaded.subscribe(()=>{}));
      await waitFor(()=>reloaded.status.connected,'reloaded service connected');
      assert.equal((await reloaded.retryPending()).replayed,true);
      assert.equal(reloaded.status.pendingRequest,null); assert.equal(values.size,0);
      const batch=(await getDocFromServer(doc(manager.db,'batches',request.id))).data();
      assert.equal(batch.status,'Processing'); assert.equal(batch.version,2);
      const events=await getDocsFromServer(query(collection(manager.db,'activity'),where('batchId','==',request.id)));
      assert.equal(events.size,2);
      assert.equal((await getDocFromServer(doc(manager.db,'batches',`${prefix}_second`))).exists(),false);
    });
    await t.test('disconnect disables shared saves and preserves confirmed data; reconnect restores writes',async()=>{
      await disableNetwork(plant.db); plant.online=false;
      await waitFor(()=>!plant.status.connected,'offline metadata');
      assert.ok(plant.data.batches.some(b=>b.id===receive.id));
      await assert.rejects(plant.service.receiveBatch({...receive,id:`${prefix}_offline`,mutationId:`${prefix}_offline_event`}),{code:'offline'});
      plant.online=true; await enableNetwork(plant.db); await waitFor(()=>plant.status.connected,'reconnected');
      assert.equal((await getDocFromServer(doc(manager.db,'batches',`${prefix}_offline`))).exists(),false);
    });
    await t.test('server-side revocation and account switches prevent stale adapters from writing',async()=>{
      await profile(shiftB.uid,'shiftB',false);
      await assert.rejects(shiftB.adapter.transitionBatch({id:`${prefix}_race`,mutationId:`${prefix}_revoked`,expectedVersion:2,expectedStatus:'Processing',staffId:staff.shiftB,piecesOut:10,weightOut:120}),{code:'access-denied'});
      await signOut(plant.auth);
      await assert.rejects(plant.adapter.receiveBatch({...receive,id:`${prefix}_signedout`,mutationId:`${prefix}_signedout_event`}),{code:'signed-out'});
    });
  } finally {
    stops.forEach(stop=>stop());
    await Promise.all(clients.map(async c=>{await terminate(c.db);await deleteApp(c.app);}));
  }
});
