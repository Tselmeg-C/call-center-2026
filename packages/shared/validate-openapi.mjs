import fs from "node:fs";
import assert from "node:assert/strict";

const text = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
assert.match(text, /^openapi:\s*3\.1\.0/m);
for (const path of ["/session/login", "/session/logout", "/session/me", "/customers", "/customers/{bcn}", "/workload", "/customers/{bcn}/follow-ups", "/customers/{bcn}/follow-ups/{followUpId}", "/customers/{bcn}/follow-ups/{followUpId}/complete", "/admin/users", "/admin/closure-reasons", "/admin/imports", "/admin/assignments", "/admin/assignments/run", "/admin/reports", "/admin/audit"]) assert.match(text, new RegExp(`^  ${path.replace(/[{}]/g, "\\$&")}:`, "m"));
const fixtures = JSON.parse(fs.readFileSync(new URL("./contract-fixtures.json", import.meta.url), "utf8"));
assert.equal(fixtures.valid.interaction.outcome, "Contact");
assert.equal(fixtures.valid.leadingZeroCustomer.bcn, "000123");
assert.equal("outcome" in fixtures.errors.missingOutcome, false);
console.log("OpenAPI contract and synthetic fixtures validated.");
