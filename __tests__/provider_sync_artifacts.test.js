import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

describe("provider sync artifacts", () => {
  it("syncs only the provider core contract baseline to rerum_openapi", () => {
    const workflowPath = path.join(repoRoot, ".github", "workflows", "sync-core-provider-contract.yml")
    const workflow = fs.readFileSync(workflowPath, "utf8")

    assert.match(workflow, /contracts\/core-provider\.openapi\.yaml/)
  })
})
