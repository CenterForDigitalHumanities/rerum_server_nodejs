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
      assert.match(artifact, /^openapi: 3\.\d+\.\d+/m)
      assert.match(artifact, /^\s+title: \S/m)
      assert.match(artifact, /^\s+version: \d+\.\d+\.\d+/m)
      assert.match(artifact, /^components:/m)
      assert.match(artifact, /^\s+schemas:/m)
    }
  })

  it("keeps the synced target artifact equivalent to the provider artifact", () => {
    const providerArtifactPath = path.join(repoRoot, "openapi/components/rerum-shared-components.openapi.yaml")
    const targetArtifactPath = path.join(repoRoot, "schemas/openapi/rerum-shared-components.openapi.yaml")
    const stripLeadingComments = (yaml) => yaml.replace(/^(?:#[^\n]*\n)+/, "")
    const provider = stripLeadingComments(fs.readFileSync(providerArtifactPath, "utf8"))
    const target = stripLeadingComments(fs.readFileSync(targetArtifactPath, "utf8"))

    assert.strictEqual(
      target,
      provider,
      "schemas/openapi/rerum-shared-components.openapi.yaml has drifted from the provider source — re-run .github/workflows/sync-rerum-shared-openapi.yml or copy openapi/components/rerum-shared-components.openapi.yaml over."
    )
  })

  it("verifies the shared artifact sync workflow configuration", () => {
    const workflowPath = path.join(repoRoot, ".github/workflows/sync-rerum-shared-openapi.yml")
    const workflow = fs.readFileSync(workflowPath, "utf8")

    assert.match(workflow, /openapi\/components\/rerum-shared-components\.openapi\.yaml/)
    assert.match(workflow, /repository:\s*cubap\/rerum_openapi/)
    assert.match(workflow, /path:\s*rerum_openapi/)
    assert.match(workflow, /peter-evans\/create-pull-request@v7/)
    assert.match(workflow, /schemas\/openapi\/rerum-shared-components\.openapi\.yaml/)
    assert.match(
      workflow,
      /cp\s+openapi\/components\/rerum-shared-components\.openapi\.yaml\s+\S*rerum_openapi\/schemas\/openapi\/rerum-shared-components\.openapi\.yaml/,
      "workflow's cp command must copy from the canonical source to the receiver target — a retargeted copy would silently corrupt the receiver"
    )
    assert.match(
      workflow,
      /secrets\.OPENAPI(?!\w)/,
      "workflow must read the org-level secret named OPENAPI — a rename here breaks the sync silently at the receiver checkout step"
    )
  })
})
