import { z } from "zod";
import { Id } from "./index.js";

export const TestEvent = z.strictObject({
  id: Id, tenantId: Id, caseId: Id, type: Id, body: z.json()
});
export const TestApprovalCommand = z.strictObject({
  id: Id, tenantId: Id, caseId: Id, approvalId: Id,
  decision: z.enum(["approved", "rejected", "cancelled"]),
  planVersion: Id
});
export const TestAcknowledgement = z.strictObject({
  id: Id, status: z.enum(["accepted", "rejected", "failed"])
});
export const TestCapabilities = z.strictObject({
  protocolVersion: z.literal(1),
  kind: z.literal("offline-test-double"),
  inference: z.literal("disabled")
});
