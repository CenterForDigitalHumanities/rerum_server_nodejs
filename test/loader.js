/**
 * Test loader for node:test framework.
 * Redirects the production database module to a test double.
 *
 * @module test/loader
 */

const rootUrl = new URL('../', import.meta.url)
const mockDatabaseUrl = new URL('../database/__mocks__/index.js', import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/database/index.js') || specifier === './database/index.js') {
    const resolved = new URL(specifier, context.parentURL ?? rootUrl)
    if (resolved.pathname.endsWith('/database/index.js')) {
      return {
        shortCircuit: true,
        url: mockDatabaseUrl.href
      }
    }
  }

  return nextResolve(specifier, context)
}
