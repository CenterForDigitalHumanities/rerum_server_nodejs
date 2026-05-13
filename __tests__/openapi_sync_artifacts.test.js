import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

describe("Shared OpenAPI artifact sync scaffolding", () => {
  it("verifies provider and target artifact files contain valid OpenAPI structure", () => {
    const providerArtifactPath = path.join(repoRoot, "openapi/components/rerum-shared-components.openapi.yaml")
    const targetArtifactPath = path.join(repoRoot, "schemas/openapi/rerum-shared-components.openapi.yaml")
    const providerArtifact = fs.readFileSync(providerArtifactPath, "utf8")
    const targetArtifact = fs.readFileSync(targetArtifactPath, "utf8")

    for (const artifact of [providerArtifact, targetArtifact]) {
      assert.match(artifact, /openapi: 3\.0\.3/)
      assert.match(artifact, /title: RERUM Shared Components/)
      assert.match(artifact, /version: 0\.1\.0/)
      assert.match(artifact, /components:/)
      assert.match(artifact, /schemas: \{\}/)
    }
  })

  it("verifies the shared artifact sync workflow configuration", () => {
    const workflowPath = path.join(repoRoot, ".github/workflows/sync-rerum-shared-openapi.yml")
    const workflow = fs.readFileSync(workflowPath, "utf8")

    assert.match(workflow, /openapi\/components\/rerum-shared-components\.openapi\.yaml/)
    assert.match(workflow, /repository:\s*cubap\/rerum_openapi/)
    assert.match(workflow, /path:\s*rerum_openapi/)
    assert.match(workflow, /peter-evans\/create-pull-request@v7/)
    assert.match(workflow, /schemas\/openapi\/rerum-shared-components\.openapi\.yaml/)
  })
})
