import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, isValidPhone, formatPhone } from "../src/lib/phone";

test("Zimbabwean formats normalise to one canonical E.164 number", () => {
  for (const raw of ["0771234567", "+263771234567", "263771234567", "+263 77 123 4567", "077 123 4567", "00263771234567", "771234567"]) {
    assert.equal(normalisePhone(raw), "+263771234567", raw);
  }
  assert.ok(isValidPhone("+263771234567"));
  assert.equal(formatPhone("+263771234567"), "+263 77 123 4567");
});

test("foreign numbers keep their country code", () => {
  assert.equal(normalisePhone("+27 82 123 4567"), "+27821234567");
});
