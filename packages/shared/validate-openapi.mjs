import fs from "node:fs";
import assert from "node:assert/strict";

const text = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
assert.match(text, /^openapi:\s*3\.1\.0/m);
for (const path of ["/session/login", "/session/logout", "/session/me", "/customers", "/customers/{bcn}", "/workload", "/customers/{bcn}/close", "/customers/{bcn}/reopen", "/customers/{bcn}/follow-ups", "/customers/{bcn}/follow-ups/{followUpId}", "/customers/{bcn}/follow-ups/{followUpId}/cancel", "/customers/{bcn}/follow-ups/{followUpId}/complete", "/admin/users", "/admin/closure-reasons", "/admin/imports", "/admin/assignment-rules", "/admin/assignment-rules/{id}", "/admin/assignments", "/admin/assignments/run", "/admin/assignments/manual/{bcn}", "/admin/assignment-fallback", "/admin/reports", "/admin/audit", "/operator/provision"]) assert.match(text, new RegExp(`^  ${path.replace(/[{}]/g, "\\$&")}:`, "m"));
const fixtures = JSON.parse(fs.readFileSync(new URL("./contract-fixtures.json", import.meta.url), "utf8"));
assert.equal(fixtures.valid.interaction.outcome, "Contact");
assert.equal(fixtures.valid.leadingZeroCustomer.bcn, "000123");
assert.equal("outcome" in fixtures.errors.missingOutcome, false);
const operationIds = [...text.matchAll(/operationId:\s*([A-Za-z0-9_]+)/g)].map(match => match[1]);
assert.equal(new Set(operationIds).size, operationIds.length, "operation IDs must be unique");
for (const id of ["login", "logout", "currentUser", "listCustomers", "getCustomer", "workload", "createInteraction", "createNote", "deleteHistory", "createFollowUp", "updateFollowUp", "cancelFollowUp", "cancelFollowUpWithSubmission", "completeFollowUp", "closeCustomer", "reopenCustomer", "listUsers", "createUser", "updateUser", "listClosureReasons", "createClosureReason", "updateClosureReason", "importWorkbook", "listAssignmentRules", "createAssignmentRule", "updateAssignmentRule", "runAssignments", "assignCustomer", "getAssignmentFallback", "setAssignmentFallback", "operatorProvision", "reports", "audit"]) assert(operationIds.includes(id), `missing operation mapping: ${id}`);
console.log("OpenAPI contract and synthetic fixtures validated.");
