// Explicit emulator-only setup. Never seeds production or creates sample batches.
const projectId = 'demo-aete';
const firestorePort = Number(process.env.FIRESTORE_PORT || 8080);
const authPort = Number(process.env.AUTH_PORT || 9099);
if (![firestorePort, authPort].every(port => Number.isInteger(port) && port > 0 && port < 65536)) throw Error('Invalid emulator port.');
const base = `http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents`;
const authBase = `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:`;
const password = 'demo-aete-only-2026';
const accounts = [
  ['manager', 'Demo Manager', 'Operations Manager', null],
  ['plant', 'Demo Plant', 'Plant Supervisor', 'Plant'],
  ['shiftA', 'Demo Shift A', 'Shift A Supervisor', 'Shift A'],
  ['shiftB', 'Demo Shift B', 'Shift B Supervisor', 'Shift B'],
];
async function authRequest(action, email) {
  const response = await fetch(`${authBase}${action}?key=demo-key`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email,password,returnSecureToken:true}),
  });
  const result = await response.json();
  return {response,result};
}
const typed = value => value === null ? {nullValue:null} : typeof value === 'boolean' ? {booleanValue:value} : {stringValue:value};
async function createIfMissing(collection,id,record) {
  const url = `${base}/${collection}/${id}`;
  const headers = {Authorization:'Bearer owner','content-type':'application/json'};
  const existing = await fetch(url,{headers});
  if (existing.ok) return;
  if (existing.status !== 404) throw Error(`Unable to inspect emulator: ${existing.status}`);
  const response = await fetch(url,{method:'PATCH',headers,body:JSON.stringify({fields:Object.fromEntries(Object.entries(record).map(([key,value])=>[key,typed(value)]))})});
  if (!response.ok) throw Error(`${response.status}: ${await response.text()}`);
}
for (const [role,name,staffRole,shift] of accounts) {
  const email = `${role.toLowerCase()}@aete.test`;
  let {response,result} = await authRequest('signUp',email);
  if (!response.ok && result.error?.message === 'EMAIL_EXISTS') ({response,result}=await authRequest('signInWithPassword',email));
  if (!response.ok) throw Error(`Emulator account setup failed: ${result.error?.message}`);
  await createIfMissing('users',result.localId,{role,active:true});
  await createIfMissing('roster',`demo-${role}`,{id:`demo-${role}`,name,role:staffRole,shift,active:true});
}
console.log('Prepared demo-aete emulator accounts and roster; no batches were created.');
console.log('Emulator emails: manager@aete.test, plant@aete.test, shifta@aete.test, shiftb@aete.test');
console.log(`Emulator-only password: ${password}`);
