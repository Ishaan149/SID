export const ACCOUNT_ROLES = Object.freeze(["manager", "plant", "shiftA", "shiftB"]);

export function accountSession(user, profile) {
  if (!user || profile?.active !== true || !ACCOUNT_ROLES.includes(profile.role)) return null;
  return { uid: user.uid, email: user.email || "", role: profile.role };
}

// Inject listeners so logout, revocation, and account-switch races can be tested.
export function observeSession({ observeAuth, observeProfile }, notify) {
  let alive = true;
  let generation = 0;
  let stopProfile = () => {};
  const stopAuth = observeAuth((user) => {
    const current = ++generation;
    stopProfile();
    stopProfile = () => {};
    if (!alive) return;
    if (!user) {
      notify({ status: "signed-out" });
      return;
    }
    notify({ status: "checking", user });
    let verified = null;
    stopProfile = observeProfile(user.uid, (profile, fromCache) => {
      if (!alive || current !== generation) return;
      // A cached profile cannot unlock a new session. An already verified
      // session stays visible read-only when offline, preserving pending forms.
      if (fromCache) {
        notify(verified ? { status: "ready", session: { ...verified, permissionsVerified: false } }
          : { status: "checking", user });
        return;
      }
      verified = accountSession(user, profile);
      notify(verified ? { status: "ready", session: { ...verified, permissionsVerified: true } }
        : { status: "unassigned", user });
    }, () => {
      verified = null;
      if (alive && current === generation) notify({ status: "error", user });
    });
  }, () => {
    ++generation;
    stopProfile();
    if (alive) notify({ status: "error" });
  });
  return () => {
    alive = false;
    ++generation;
    stopProfile();
    stopAuth();
  };
}

export function loginErrorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-email":
    case "auth/user-disabled":
      return "Unable to sign in. Check your email and password, or contact your manager.";
    case "auth/too-many-requests":
      return "Too many sign-in attempts. Please wait before trying again.";
    case "auth/network-request-failed":
      return "Unable to connect to Firebase. Check your internet connection and try again.";
    default:
      return "Sign-in is unavailable. Please try again or contact your manager.";
  }
}
