import test from "node:test";
import assert from "node:assert/strict";
import { accountSession, observeSession, loginErrorMessage } from "../src/auth/session.js";
import { readFirebaseConfig } from "../src/data/firebaseClient.js";

function listeners() {
  const states = [];
  const profiles = [];
  let authNext;
  let authError;
  let authStopped = false;
  const stop = observeSession({
    observeAuth(next, error) { authNext = next; authError = error; return () => { authStopped = true; }; },
    observeProfile(uid, next, error) {
      const listener = { uid, next, error, stopped: false };
      profiles.push(listener);
      return () => { listener.stopped = true; };
    },
  }, (state) => states.push(state));
  return { states, profiles, auth: (user) => authNext(user), failAuth: () => authError(), stop,
    get authStopped() { return authStopped; } };
}

test("only active, recognized server profiles grant a role; roster/PIN fields cannot grant access", () => {
  const user = { uid: "u1", email: "manager@example.test" };
  for (const role of ["manager", "plant", "shiftA", "shiftB"]) {
    assert.equal(accountSession(user, { role, active: true }).role, role);
  }
  for (const profile of [null, {}, { role: "manager" }, { role: "manager", active: false },
    { role: "manager", active: "true" }, { role: "admin", active: true }, { pin: "1234", active: true },
    { role: "Operations Manager", active: true }]) {
    assert.equal(accountSession(user, profile), null);
  }
});

test("logout and account switches invalidate queued callbacks from the previous account", () => {
  const h = listeners();
  h.auth({ uid: "a" });
  const old = h.profiles[0];
  old.next({ role: "manager", active: true }, false);
  assert.equal(h.states.at(-1).status, "ready");
  h.auth({ uid: "b" });
  assert.equal(old.stopped, true);
  old.next({ role: "manager", active: true }, false);
  assert.equal(h.states.at(-1).status, "checking");
  h.profiles[1].next({ role: "plant", active: true }, false);
  assert.equal(h.states.at(-1).session.uid, "b");
  h.auth(null);
  h.profiles[1].next({ role: "manager", active: true }, false);
  assert.equal(h.states.at(-1).status, "signed-out");
  h.stop();
});

test("cached roles cannot unlock access; revocation and listener failure close the tracker", () => {
  const h = listeners();
  h.auth({ uid: "a" });
  const profile = h.profiles[0];
  profile.next({ role: "manager", active: true }, true);
  assert.equal(h.states.at(-1).status, "checking");
  profile.next({ role: "manager", active: true }, false);
  assert.equal(h.states.at(-1).status, "ready");
  profile.next({ role: "manager", active: false }, false);
  assert.equal(h.states.at(-1).status, "unassigned");
  profile.next(null, false);
  assert.equal(h.states.at(-1).status, "unassigned");
  profile.next({ role: "shiftA", active: true }, false);
  assert.equal(h.states.at(-1).session.role, "shiftA");
  profile.error(new Error("permission denied"));
  assert.equal(h.states.at(-1).status, "error");
  h.stop();
});

test("unmount and Auth errors unsubscribe listeners and reject late events", () => {
  const h = listeners();
  h.auth({ uid: "a" });
  h.failAuth();
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.profiles[0].stopped, true);
  h.stop();
  const count = h.states.length;
  h.profiles[0].next({ role: "manager", active: true }, false);
  h.auth({ uid: "b" });
  assert.equal(h.states.length, count);
  assert.equal(h.authStopped, true);
});

test("login errors avoid disclosing account existence and expose actionable network failures", () => {
  assert.equal(loginErrorMessage({ code: "auth/user-not-found" }), loginErrorMessage({ code: "auth/wrong-password" }));
  assert.match(loginErrorMessage({ code: "auth/network-request-failed" }), /internet connection/);
  assert.match(loginErrorMessage({ code: "auth/too-many-requests" }), /wait/);
});

test("Firebase config requires explicit values and never defaults to a real project in emulator mode", () => {
  assert.throws(() => readFirebaseConfig({}), /configuration is missing/);
  assert.throws(() => readFirebaseConfig({ PROD: true, VITE_FIREBASE_USE_EMULATOR: "true" }), /Production/);
  assert.equal(readFirebaseConfig({ VITE_FIREBASE_USE_EMULATOR: "true", VITE_FIREBASE_PROJECT_ID: "production" }).projectId, "demo-aete");
  const values = {
    VITE_FIREBASE_API_KEY: "key", VITE_FIREBASE_AUTH_DOMAIN: "project.firebaseapp.com", VITE_FIREBASE_PROJECT_ID: "project",
    VITE_FIREBASE_STORAGE_BUCKET: "bucket", VITE_FIREBASE_MESSAGING_SENDER_ID: "123", VITE_FIREBASE_APP_ID: "app",
  };
  assert.equal(readFirebaseConfig(values).projectId, "project");
});

test('verified sessions remain visible read-only offline; cached access cannot undo revocation or a listener error', () => {
  const h = listeners(); h.auth({ uid: 'a' }); const profile=h.profiles[0];
  profile.next({role:'plant',active:true},false); assert.equal(h.states.at(-1).session.permissionsVerified,true);
  profile.next({role:'manager',active:true},true);
  assert.equal(h.states.at(-1).session.role,'plant'); assert.equal(h.states.at(-1).session.permissionsVerified,false);
  profile.next({role:'plant',active:true},false); assert.equal(h.states.at(-1).session.permissionsVerified,true);
  profile.next({role:'plant',active:false},false); profile.next({role:'plant',active:true},true);
  assert.equal(h.states.at(-1).status,'checking');
  profile.next({role:'plant',active:true},false); profile.error(Error()); profile.next({role:'plant',active:true},true);
  assert.equal(h.states.at(-1).status,'checking'); h.stop();
});
