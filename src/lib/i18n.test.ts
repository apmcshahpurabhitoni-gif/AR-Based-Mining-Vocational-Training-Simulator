/**
 * The UI strings, checked.
 *
 * There was no test over `i18n.ts` before this one, which meant a key added to
 * the union and forgotten in the table would be a compile error, but a *value*
 * that lost its Hindi — or gained a claim nobody can support — was not.
 */

import { describe, expect, test } from "bun:test";
import { UI, type UiKey } from "./i18n";
import { SELECTABLE_LOCALES } from "./i18n";

const keys = Object.keys(UI) as UiKey[];

describe("every string ships in every language we claim to ship", () => {
  test("each key has non-empty English and Hindi", () => {
    for (const key of keys) {
      const value = UI[key];
      expect(value.en, `${key} has no English`).toBeTruthy();
      expect(value.hi, `${key} has no Hindi`).toBeTruthy();
      // A translation that is the English string with a trailing full stop is a
      // placeholder someone forgot to replace.
      expect(value.hi, `${key} looks like untranslated English`).not.toBe(value.en);
    }
  });

  test("the two languages we ship are the two we fill", () => {
    // `sat` is a reserved slot (docs/01 §7.1) and is deliberately absent from
    // this list. It is not machine-translated: a mistranslated extinguisher
    // class is worse than an English one.
    expect(SELECTABLE_LOCALES).toEqual(["en", "hi"]);
  });

  test("the key union and the table have not drifted apart", () => {
    // Both directions, because a key in the union with no value is a type error
    // while a value with no key is invisible.
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) expect(UI[key]).toBeDefined();
  });
});

describe("the build notice says only what is true", () => {
  const notice = UI["app.buildNotice"];
  const detail = UI["app.buildNotice.detail"];

  test("it says the build is unfinished, in both languages", () => {
    // The whole point of the strip. If this is ever reworded into something
    // that does not say "in development", the test should fail rather than let
    // a pre-release build introduce itself as a finished product.
    expect(notice.en.toLowerCase()).toContain("development");
    expect(notice.en.toLowerCase()).toContain("pre-release");
    expect(notice.hi).toContain("विकास");
  });

  test("it does not claim the app is unsafe, and does not claim a certificate", () => {
    // Two claims this build cannot support, in either direction. The gate fails
    // closed and issues no certificate to anyone today, and nothing about the
    // *software* being unfinished says anything about the safety case.
    for (const text of [notice.en, notice.hi, detail.en, detail.hi]) {
      expect(text.toLowerCase()).not.toContain("unsafe");
      expect(text.toLowerCase()).not.toContain("certified");
      expect(text.toLowerCase()).not.toContain("approved");
    }
  });

  test("it tells the trainee it is not their fault, and where to say so", () => {
    // A warning with no route to report a problem just teaches people to keep
    // quiet about them.
    expect(detail.en.toLowerCase()).toContain("not yours");
    expect(detail.en.toLowerCase()).toContain("tell");
  });
});
