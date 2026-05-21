import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const contractPath = path.join(repoRoot, "openapi", "contracts", "core-provider.openapi.yaml")
const workflowPath = path.join(repoRoot, ".github", "workflows", "sync-core-provider-contract.yml")

describe("provider sync artifacts", () => {
  it("the provider contract source file has valid OpenAPI structure", () => {
    const contract = fs.readFileSync(contractPath, "utf8")
    assert.match(contract, /^openapi: 3\.\d+\.\d+/m)
    assert.match(contract, /^\s+title: \S/m)
    assert.match(contract, /^\s+version: \d+\.\d+\.\d+/m)
    assert.match(contract, /^paths:/m)
  })

  it("the sync workflow copies the contract to the correct downstream baseline path", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8")
    // Asserting the literal cp command is what catches a retargeted copy. The target
    // path appears in the PR body text too, so a substring match alone is too loose.
    assert.match(
      workflow,
      /cp\s+openapi\/contracts\/core-provider\.openapi\.yaml\s+\S*receiver\/seams\/tinynode-to-rerum\/openapi\/baseline\.openapi\.yaml/
    )
    assert.match(workflow, /repository:\s*cubap\/rerum_openapi/)
    assert.match(workflow, /peter-evans\/create-pull-request@v\d+/)
    assert.match(
      workflow,
      /secrets\.OPENAPI(?!\w)/,
      "workflow must read the org-level secret named OPENAPI — a rename here breaks the sync silently at the receiver checkout step"
    )
  })
})
