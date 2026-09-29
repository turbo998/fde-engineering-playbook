import test from "node:test";
import assert from "node:assert/strict";
import { EffectRequest, Hotel, HotelContract, Money, Resource, SeedStatus } from "../packages/contracts/src/index.js";
import { canonicalJson } from "../packages/lab/src/encoding.js";
import { request, clock } from "./helpers.js";

test("money rejects fractional, negative and unsafe integer minor units", () => {
  for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.equal(Money.safeParse({ minorUnits: value, currency: "XXX" }).success, false);
  }
  assert.equal(Money.safeParse({ minorUnits: 0, currency: "XXX" }).success, true);
});
test("effect schema rejects JSON-supplied roles and unknown actions", () => {
  assert.equal(EffectRequest.safeParse({ ...request, role: "operations_approver" }).success, false);
  assert.equal(EffectRequest.safeParse({ ...request, action: "arbitrary_purchase" }).success, false);
});
test("contract validity is explicit and versioned", () => {
  const contract = {
    id: "unit", tenantId: "unit", hotelId: "unit", version: "v1",
    validFrom: clock, validUntil: clock, cancellationTerms: "unit", compensationTerms: "unit", evidenceIds: ["unit"]
  };
  assert.equal(HotelContract.safeParse(contract).success, false);
  assert.equal(HotelContract.safeParse({ ...contract, validUntil: "2000-02-01T00:00:00.000Z" }).success, true);
});
test("unknown inventory is distinct from availability", () => {
  const hotel = {
    id: "unit", tenantId: "unit", name: "synthetic unit", class: "unit",
    roomCategory: "unit", occupancy: 1, distanceMetres: 901, address: "synthetic unit",
    capacity: "unknown", evidenceIds: ["unit"]
  };
  assert.equal(Hotel.parse(hotel).capacity, "unknown");
  assert.equal(Resource.safeParse({ kind: "hotel", data: { ...hotel, capacity: "booked" } }).success, false);
});
test("seed status cannot pretend to be a completed application", () => {
  assert.equal(SeedStatus.safeParse({
    schemaVersion: 1, kind: "neutral-seed", benchmarkStatus: "completed",
    inference: "enabled", businessImplementation: true, storage: "sqlite", bootCount: 1
  }).success, false);
});
test("canonical encoding is order-independent and rejects non-JSON data", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  for (const value of [undefined, NaN, new Date(), { a: undefined }]) assert.throws(() => canonicalJson(value));
});
