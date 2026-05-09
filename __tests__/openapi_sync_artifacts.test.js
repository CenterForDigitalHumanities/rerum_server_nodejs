import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

describe("Shared OpenAPI artifact sync scaffolding", () => {
  it("keeps provider and target artifact files in place", () => {
    const providerArtifactPath = path.join(repoRoot, "openapi/components/rerum-shared-components.openapi.yaml")
    const targetArtifactPath = path.join(repoRoot, "schemas/openapi/rerum-shared-components.openapi.yaml")
    const providerArtifact = fs.readFileSync(providerArtifactPath, "utf8")
    const targetArtifact = fs.readFileSync(targetArtifactPath, "utf8")

    expect(fs.existsSync(providerArtifactPath)).toBeTruthy()
    expect(fs.existsSync(targetArtifactPath)).toBeTruthy()
    expect(providerArtifact).toContain("openapi: 3.0.3")
    expect(providerArtifact).toContain("version: 0.1.0")
    expect(targetArtifact).toContain("openapi: 3.0.3")
    expect(targetArtifact).toContain("version: 0.1.0")
  })

  it("dispatches the shared artifact sync workflow for provider changes", () => {
    const workflowPath = path.join(repoRoot, ".github/workflows/sync-rerum-shared-openapi.yml")
    const workflow = fs.readFileSync(workflowPath, "utf8")

    expect(workflow).toContain("openapi/components/rerum-shared-components.openapi.yaml")
    expect(workflow).toContain("sync-provider-artifact.yml")
    expect(workflow).toContain("repo: 'rerum_openapi'")
    expect(workflow).toContain("target_artifact_path: 'schemas/openapi/rerum-shared-components.openapi.yaml'")
  })
})
