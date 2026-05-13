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
