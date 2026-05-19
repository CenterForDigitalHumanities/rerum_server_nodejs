import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const apiRoutesPath = path.join(repoRoot, 'routes', 'api-routes.js')
const contractPath = path.join(repoRoot, 'contracts', 'core-provider.openapi.yaml')

const skippedMountedRouters = new Set([
  './static.js',
  './compatability.js'
])

/**
 * Normalize route paths from Express format to OpenAPI format
 * /id/:id -> /id/{id}
 */
function normalizeRoutePath(routePath) {
  return routePath
    .replace(/\/:([A-Za-z0-9_]+)/g, '/{$1}')
    .replace(/\{_?id\}/g, '{id}')
}

/**
 * Join mounted prefix with route path
 */
function joinMountedPath(prefix, routePath) {
  const suffix = routePath === '/' ? '' : routePath
  return normalizeRoutePath(`${prefix}${suffix}`.replace(/\/+/g, '/'))
}

/**
 * Parse ES6 import statements from source
 */
function parseImports(source) {
  const imports = new Map()
  const importPattern = /^import\s+(\w+)\s+from\s+'(\.\/[^']+)';?$/gm
  for (const match of source.matchAll(importPattern)) {
    imports.set(match[1], match[2])
  }
  return imports
}

/**
 * Parse router.use() mounted subrouters
 */
function parseMountedRouters(source, imports) {
  const mounted = []
  const usePattern = /router\.use\('([^']+)',\s*(\w+)\)/g
  for (const match of source.matchAll(usePattern)) {
    const importPath = imports.get(match[2])
    if (!importPath || skippedMountedRouters.has(importPath)) {
      continue
    }
    mounted.push({
      prefix: match[1],
      filePath: path.join(repoRoot, 'routes', importPath.replace('./', ''))
    })
  }
  return mounted
}

/**
 * Parse route operations from a route file
 */
function parseRouteOperations(filePath, prefix) {
  const source = fs.readFileSync(filePath, 'utf8')
  const operations = new Set()
  const routeBlockPattern = /router\.route\('([^']+)'\)([\s\S]*?)(?=\nrouter\.route\(|\nexport default)/g
  for (const match of source.matchAll(routeBlockPattern)) {
    const routePath = joinMountedPath(prefix, match[1])
    const methods = new Set()
    for (const methodMatch of match[2].matchAll(/\.(get|post|put|patch|delete|head)\(/g)) {
      methods.add(methodMatch[1].toUpperCase())
    }
    for (const method of methods) {
      operations.add(`${method} ${routePath}`)
    }
  }
  return operations
}

/**
 * Parse direct router.METHOD() operations
 */
function parseDirectOperations(source) {
  const operations = new Set()
  const directPattern = /router\.(get|post|put|patch|delete|head)\('([^']+)'/g
  for (const match of source.matchAll(directPattern)) {
    if (match[2] === '/api') {
      operations.add(`${match[1].toUpperCase()} ${match[2]}`)
    }
  }
  return operations
}

/**
 * Get all mounted core provider operations
 */
function getMountedCoreProviderOperations() {
  const source = fs.readFileSync(apiRoutesPath, 'utf8')
  const imports = parseImports(source)
  const operations = new Set(parseDirectOperations(source))
  for (const mountedRouter of parseMountedRouters(source, imports)) {
    for (const operation of parseRouteOperations(mountedRouter.filePath, mountedRouter.prefix)) {
      operations.add(operation)
    }
  }
  return Array.from(operations).sort()
}

/**
 * Parse operations from OpenAPI contract
 */
function getContractOperations() {
  const lines = fs.readFileSync(contractPath, 'utf8').split('\n')
  const operations = []
  let currentPath = ''
  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/)
    if (pathMatch) {
      currentPath = pathMatch[1]
      continue
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete|head):\s*$/)
    if (methodMatch && currentPath) {
      operations.push(`${methodMatch[1].toUpperCase()} ${normalizeRoutePath(currentPath)}`)
    }
  }
  return operations.sort()
}

/**
 * Parse declared response status codes for every operation in the contract.
 * Returns a Map keyed by "METHOD /path" with a Set of three-digit code strings.
 * The line parser keys off indentation: paths at 2 spaces, methods at 4 spaces,
 * response codes at 8 spaces inside a `responses:` block.
 */
function getContractResponseCodesByOperation() {
  const lines = fs.readFileSync(contractPath, 'utf8').split('\n')
  const operations = new Map()
  let currentPath = ''
  let currentOp = ''
  let insideResponses = false
  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/)
    if (pathMatch) {
      currentPath = pathMatch[1]
      currentOp = ''
      insideResponses = false
      continue
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete|head):\s*$/)
    if (methodMatch && currentPath) {
      currentOp = `${methodMatch[1].toUpperCase()} ${normalizeRoutePath(currentPath)}`
      operations.set(currentOp, new Set())
      insideResponses = false
      continue
    }
    if (line.match(/^      responses:\s*$/)) {
      insideResponses = true
      continue
    }
    // A new 6-space key under the same method ends the responses block.
    if (insideResponses && line.match(/^      [A-Za-z]/)) {
      insideResponses = false
    }
    const codeMatch = line.match(/^        '(\d{3})':\s*$/)
    if (codeMatch && insideResponses && currentOp) {
      operations.get(currentOp).add(codeMatch[1])
    }
  }
  return operations
}

/**
 * Codes the contract MUST declare for each operation. Each entry is the floor:
 * adding new codes is fine; removing or changing one fails the test. Updates to
 * this catalogue should be made in lockstep with the matching per-route test
 * (e.g. routes/__tests__/create.test.js asserts 201 — so '201' must be here too).
 */
const requiredResponseCodes = {
  'POST /api/create': ['201', '400', '401', '409', '413', '415'],
  'POST /api/bulkCreate': ['201', '400', '401', '413', '415'],
  'DELETE /api/delete/{id}': ['204', '401', '403', '404'],
  'PUT /api/overwrite': ['200', '400', '401', '403', '404', '409', '413', '415'],
  'PUT /api/update': ['200', '400', '401', '403', '404', '413', '415'],
  // /bulkUpdate silently skips not-found/deleted items per controllers/bulk.js:157-158, so 403/404 are not promised.
  'PUT /api/bulkUpdate': ['200', '400', '401', '413', '415'],
  // /patch, /set, /unset return 501 (not 404) when the object is not in RERUM — controllers/patchUpdate.js:41 and siblings.
  'PATCH /api/patch': ['200', '400', '401', '403', '413', '415', '501'],
  'PATCH /api/set': ['200', '400', '401', '403', '413', '415', '501'],
  'PATCH /api/unset': ['200', '400', '401', '403', '413', '415', '501'],
  // 409 is reachable via slug conflict (utils.createExpressError maps code 11000 → 409).
  'PATCH /api/release/{id}': ['200', '400', '401', '403', '404', '409'],
  'GET /id/{id}': ['200', '404'],
  'GET /since/{id}': ['200', '404'],
  'GET /history/{id}': ['200', '404'],
  'POST /api/query': ['200', '400', '413', '415'],
  'POST /api/search': ['200', '400', '413', '415'],
  'POST /api/search/phrase': ['200', '400', '413', '415']
}

describe('Core Provider Contract', () => {
  it('Mounted routes match the core provider contract', () => {
    const contractOps = getContractOperations()
    const implementedOps = getMountedCoreProviderOperations()

    assert.deepEqual(
      implementedOps,
      contractOps,
      'Implemented routes do not match contract specification'
    )
  })
})

describe('Core Provider Contract response codes', () => {
  const declared = getContractResponseCodesByOperation()

  for (const [operation, expectedCodes] of Object.entries(requiredResponseCodes)) {
    it(`${operation} declares ${expectedCodes.join(', ')}`, () => {
      const actual = declared.get(operation)
      assert.ok(actual, `Operation ${operation} is missing from the contract`)
      const missing = expectedCodes.filter(code => !actual.has(code))
      assert.deepStrictEqual(
        missing,
        [],
        `Contract drift: ${operation} must declare ${expectedCodes.join(', ')} but is missing ${missing.join(', ')}`
      )
    })
  }
})
