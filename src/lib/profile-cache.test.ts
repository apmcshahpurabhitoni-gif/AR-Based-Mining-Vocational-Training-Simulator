import { describe, expect, test } from "bun:test";
import {
  PROFILE_KEY,
  clearCachedProfile,
  readCachedProfile,
  writeCachedProfile,
  type StorageLike,
} from "./profile-cache";
import type { Profile } from "./api";

/** In-memory `Storage` stand-in, with hooks for the failure modes. */
function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const PROFILE: Profile = {
  id: "u1",
  name: "Ravi Kumar",
  email: "ravi@example.org",
  role: "worker",
  workerCode: "JC-114",
  orgId: "o1",
  orgName: "Jharia Coalt Mines",
  preferredLocale: "hi",
};

describe("profile cache — the offline fallback that makes the app openable", () => {
  test("round-trips a profile the server confirmed", () => {
    const storage = fakeStorage();
    writeCachedProfile(storage, PROFILE);
    expect(readCachedProfile(storage)).toEqual(PROFILE);
  });

  test("no cache reads as null, not as a blank profile", () => {
    // A synthetic empty profile would put "?" and "Signed in" in the shell and
    // let RequireAuth through with an identity nobody vouched for.
    expect(readCachedProfile(fakeStorage())).toBeNull();
  });

  test("signing out forgets the identity", () => {
    const storage = fakeStorage();
    writeCachedProfile(storage, PROFILE);
    clearCachedProfile(storage);
    expect(readCachedProfile(storage)).toBeNull();
    // Leaving it behind would let the next person to pick up the handset into
    // a signed-in shell.
    expect(storage.map.has(PROFILE_KEY)).toBe(false);
  });
});

describe("profile cache — it is display-only, so it is shape-checked", () => {
  /**
   * Anything on the device can write localStorage, so this cache is not
   * evidence of anything. It is read into the UI, which is exactly why a
   * malformed value is discarded instead of being spread around as if it were
   * real. It is never used for authorisation, so the worst a forged value can
   * do is change a name on screen.
   */
  function withRaw(value: string): StorageLike {
    const storage = fakeStorage();
    storage.map.set(PROFILE_KEY, value);
    return storage;
  }

  test("rejects unparseable JSON", () => {
    expect(readCachedProfile(withRaw("{not json"))).toBeNull();
  });

  test("rejects a non-object", () => {
    expect(readCachedProfile(withRaw('"a string"'))).toBeNull();
    expect(readCachedProfile(withRaw("42"))).toBeNull();
    expect(readCachedProfile(withRaw("null"))).toBeNull();
    expect(readCachedProfile(withRaw("[]"))).toBeNull();
  });

  test("rejects a profile with no usable identity", () => {
    expect(readCachedProfile(withRaw('{"name":"Ravi"}'))).toBeNull();
    expect(readCachedProfile(withRaw('{"id":"u1"}'))).toBeNull();
    expect(readCachedProfile(withRaw('{"id":"","name":"Ravi"}'))).toBeNull();
  });

  test("rejects a role outside the enum rather than trusting it", () => {
    // A forged `"admin"` would be the valuable forgery here. Dropping the
    // whole entry is heavier-handed than blanking the field, and heavier is
    // right: it means RequireAuth sends the trainee to sign in rather than
    // showing them a shell with an unverifiable role in it.
    expect(readCachedProfile(withRaw('{"id":"u1","name":"Ravi","role":"superuser"}'))).toBeNull();
    expect(readCachedProfile(withRaw('{"id":"u1","name":"Ravi"}'))).toBeNull();
  });

  test("keeps a valid profile and normalises the optional fields", () => {
    const read = readCachedProfile(
      withRaw('{"id":"u1","name":"Ravi","role":"supervisor","workerCode":7}'),
    );
    expect(read).toEqual({
      id: "u1",
      name: "Ravi",
      email: null,
      role: "supervisor",
      workerCode: null,
      orgId: "",
      orgName: "",
      preferredLocale: null,
    });
  });

  test("accepts every role the app knows", () => {
    for (const role of ["worker", "supervisor", "admin"] as const) {
      const read = readCachedProfile(
        withRaw(JSON.stringify({ id: "u1", name: "Ravi", role })),
      );
      expect(read?.role).toBe(role);
    }
  });
});

describe("profile cache — storage that does not work", () => {
  test("a missing storage object is not a crash", () => {
    expect(readCachedProfile(null)).toBeNull();
    expect(() => writeCachedProfile(null, PROFILE)).not.toThrow();
    expect(() => clearCachedProfile(null)).not.toThrow();
  });

  test("private mode: reads and clears survive, writes do not throw", () => {
    // Safari with storage disabled throws on every access. A trainee losing
    // their offline app to a quota error would be a far worse outcome than
    // showing no cached name, so nothing here is allowed to propagate.
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };

    expect(readCachedProfile(hostile)).toBeNull();
    expect(() => writeCachedProfile(hostile, PROFILE)).not.toThrow();
    expect(() => clearCachedProfile(hostile)).not.toThrow();
  });
});
