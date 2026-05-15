import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

import patchSetRouter from '../patchSet.js'
import patchUnsetRouter from '../patchUnset.js'
import patchUpdateRouter from '../patchUpdate.js'
import clientRouter from '../client.js'
import createRouter from '../create.js'
import bulkCreateRouter from '../bulkCreate.js'
import bulkUpdateRouter from '../bulkUpdate.js'
import deleteRouter from '../delete.js'
import historyRouter from '../history.js'
import idRouter from '../id.js'
import overwriteRouter from '../overwrite.js'
import staticRouter from '../static.js'
import sinceRouter from '../since.js'
import updateRouter from '../putUpdate.js'
import indexRouter from '../index.js'
import searchRouter from '../search.js'
import queryRouter from '../query.js'
import releaseRouter from '../release.js'
import apiRoutesRouter from '../api-routes.js'

function getRoute(router, path) {
  const routeLayer = router.stack.find(layer => layer.route?.path === path)
  assert.ok(routeLayer, `Expected route for path '${path}'`)
  return routeLayer.route
}

function getMethodLayers(router, path, method) {
  return getRoute(router, path).stack.filter(layer => layer.method === method)
}

function createResponse() {
  return {
    headers: {},
    statusCode: undefined,
    statusMessage: undefined,
    body: undefined,
    ended: false,
    set(name, value) {
      this.headers[name] = value
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
    send(value) {
      this.body = value
      this.ended = true
      return this
    },
    sendFile(filePath, options) {
      this.body = { filePath, options }
      this.ended = true
      return this
    },
    end() {
      this.ended = true
      return this
    }
  }
}

function invokeLayer(layer, req = {}, res = createResponse()) {
  const nextCalls = []
  layer.handle(req, res, arg => nextCalls.push(arg))
  return { res, nextCalls }
}

function getOverrideLayer(router) {
  const postLayers = getMethodLayers(router, '/', 'post')
  const overrideLayer = postLayers.at(-2)
  assert.ok(overrideLayer, 'Expected override middleware layer')
  return overrideLayer
}

function assertInvalidOverride(router, expectedMessage) {
  const { res, nextCalls } = invokeLayer(getOverrideLayer(router), {
    header() {
      return undefined
    }
  })

  assert.strictEqual(res.statusCode, 405)
  assert.strictEqual(res.statusMessage, expectedMessage)
  assert.strictEqual(res.ended, true)
  assert.deepStrictEqual(nextCalls, [])
}

function assertValidOverride(router) {
  const { res, nextCalls } = invokeLayer(getOverrideLayer(router), {
    header(name) {
      return name === 'X-HTTP-Method-Override' ? 'PATCH' : undefined
    }
  })

  assert.strictEqual(res.statusCode, undefined)
  assert.strictEqual(res.ended, false)
  assert.strictEqual(nextCalls.length, 1)
  assert.strictEqual(nextCalls[0], undefined)
}

function assertUnsupportedMethod(router, expectedMessage) {
  const fallbackLayer = getRoute(router, '/').stack.at(-1)
  assert.ok(fallbackLayer, 'Expected fallback .all() layer')

  const { res, nextCalls } = invokeLayer(fallbackLayer)

  assert.strictEqual(res.statusCode, 405)
  assert.strictEqual(res.statusMessage, expectedMessage)
  assert.strictEqual(res.ended, true)
  assert.deepStrictEqual(nextCalls, [])
}

function assertUnsupportedMethodOnPath(router, path, expectedMessage) {
  const fallbackLayer = getRoute(router, path).stack.at(-1)
  assert.ok(fallbackLayer, `Expected fallback .all() layer for '${path}'`)

  const { res, nextCalls } = invokeLayer(fallbackLayer)

  assert.strictEqual(res.statusCode, 405)
  assert.strictEqual(res.statusMessage, expectedMessage)
  assert.strictEqual(res.ended, true)
  assert.deepStrictEqual(nextCalls, [])
}

describe('patch route wrappers', () => {
  it('rejects POST /set requests without PATCH override', () => {
    assertInvalidOverride(
      patchSetRouter,
      'Improper request method for updating, please use PATCH to add new keys to this object.'
    )
  })

  it('passes POST /set requests with PATCH override to the next handler', () => {
    assertValidOverride(patchSetRouter)
  })

  it('rejects unsupported methods for /set', () => {
    assertUnsupportedMethod(
      patchSetRouter,
      'Improper request method for updating, please use PATCH to add new keys to this object.'
    )
  })

  it('rejects POST /unset requests without PATCH override', () => {
    assertInvalidOverride(
      patchUnsetRouter,
      'Improper request method for updating, please use PATCH to remove keys from this object.'
    )
  })

  it('passes POST /unset requests with PATCH override to the next handler', () => {
    assertValidOverride(patchUnsetRouter)
  })

  it('rejects unsupported methods for /unset', () => {
    assertUnsupportedMethod(
      patchUnsetRouter,
      'Improper request method for updating, please use PATCH to remove keys from this object.'
    )
  })

  it('rejects POST /patch requests without PATCH override', () => {
    assertInvalidOverride(
      patchUpdateRouter,
      'Improper request method for updating, please use PATCH to alter the existing keys this object.'
    )
  })

  it('passes POST /patch requests with PATCH override to the next handler', () => {
    assertValidOverride(patchUpdateRouter)
  })

  it('rejects unsupported methods for /patch', () => {
    assertUnsupportedMethod(
      patchUpdateRouter,
      'Improper request method for updating, please use PATCH to alter existing keys on this object.'
    )
  })
})

describe('client route wrappers', () => {
  it('builds the Auth0 registration URL with the expected query params', async () => {
    const audience = process.env.AUDIENCE
    const clientId = process.env.CLIENT_ID
    const rerumPrefix = process.env.RERUM_PREFIX

    process.env.AUDIENCE = 'https://example.org/audience'
    process.env.CLIENT_ID = 'client-123'
    process.env.RERUM_PREFIX = 'https://example.org/rerum'

    const app = express()
    app.use('/client', clientRouter)

    try {
      const response = await request(app).get('/client/register')

      assert.strictEqual(response.statusCode, 200)
      const registrationUrl = new URL(response.text)
      assert.strictEqual(registrationUrl.origin + registrationUrl.pathname, 'https://cubap.auth0.com/authorize')
      assert.strictEqual(registrationUrl.searchParams.get('audience'), 'https://example.org/audience')
      assert.strictEqual(registrationUrl.searchParams.get('scope'), 'offline_access')
      assert.strictEqual(registrationUrl.searchParams.get('response_type'), 'code')
      assert.strictEqual(registrationUrl.searchParams.get('client_id'), 'client-123')
      assert.strictEqual(registrationUrl.searchParams.get('redirect_uri'), 'https://example.org/rerum')
      assert.strictEqual(registrationUrl.searchParams.get('state'), 'register')
    }
    finally {
      process.env.AUDIENCE = audience
      process.env.CLIENT_ID = clientId
      process.env.RERUM_PREFIX = rerumPrefix
    }
  })

  it('returns a plain-text success response from the verified token handler', () => {
    const verifyHandler = getMethodLayers(clientRouter, '/verify', 'get').at(-1)
    assert.ok(verifyHandler, 'Expected verify handler after auth middleware')

    const { res, nextCalls } = invokeLayer(verifyHandler, {
      user: {
        'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/test-agent'
      }
    })

    assert.strictEqual(res.headers['Content-Type'], 'text/plain')
    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.body, 'The token was verified by Auth0')
    assert.deepStrictEqual(nextCalls, [])
  })
})

describe('search, query, and release fallbacks', () => {
  it('rejects unsupported methods for /bulkCreate', () => {
    assertUnsupportedMethod(
      bulkCreateRouter,
      'Improper request method for creating, please use POST.'
    )
  })

  it('rejects unsupported methods for /bulkUpdate', () => {
    assertUnsupportedMethod(
      bulkUpdateRouter,
      'Improper request method for creating, please use PUT.'
    )
  })

  it('rejects unsupported methods for /create', () => {
    assertUnsupportedMethod(
      createRouter,
      'Improper request method for creating, please use POST.'
    )
  })

  it('rejects unsupported methods for /update', () => {
    assertUnsupportedMethod(
      updateRouter,
      'Improper request method for updating, please use PUT to update this object.'
    )
  })

  it('rejects unsupported methods for /overwrite', () => {
    assertUnsupportedMethod(
      overwriteRouter,
      'Improper request method for overwriting, please use PUT to overwrite this object.'
    )
  })

  it('rejects unsupported methods for /search', () => {
    assertUnsupportedMethod(
      searchRouter,
      'Improper request method for search.  Please use POST.'
    )
  })

  it('rejects unsupported methods for /search/phrase', () => {
    const fallbackLayer = getRoute(searchRouter, '/phrase').stack.at(-1)
    assert.ok(fallbackLayer, 'Expected fallback .all() layer for /phrase')

    const { res, nextCalls } = invokeLayer(fallbackLayer)

    assert.strictEqual(res.statusCode, 405)
    assert.strictEqual(res.statusMessage, 'Improper request method for search.  Please use POST.')
    assert.strictEqual(res.ended, true)
    assert.deepStrictEqual(nextCalls, [])
  })

  it('rejects unsupported methods for /query', () => {
    assertUnsupportedMethod(
      queryRouter,
      'Improper request method for requesting objects with matching properties.  Please use POST.'
    )
  })

  it('rejects unsupported methods for /release/:id', () => {
    assertUnsupportedMethodOnPath(
      releaseRouter,
      '/:_id',
      'Improper request method for releasing, please use PATCH to release this object.'
    )
  })

  it('rejects unsupported methods for /delete/:id', () => {
    assertUnsupportedMethodOnPath(
      deleteRouter,
      '/:_id',
      'Improper request method for deleting, please use DELETE.'
    )
  })

  it('rejects unsupported methods for /history/:id', () => {
    assertUnsupportedMethodOnPath(
      historyRouter,
      '/:_id',
      'Improper request method, please use GET.'
    )
  })

  it('rejects unsupported methods for /id/:id', () => {
    assertUnsupportedMethodOnPath(
      idRouter,
      '/:_id',
      'Improper request method, please use GET.'
    )
  })

  it('rejects unsupported methods for /since/:id', () => {
    assertUnsupportedMethodOnPath(
      sinceRouter,
      '/:_id',
      'Improper request method, please use GET.'
    )
  })
})

describe('api routes discovery', () => {
  it('directly serves the welcome page from the static route handler', () => {
    const handler = getMethodLayers(staticRouter, '/', 'get').at(-1)
    assert.ok(handler, 'Expected static router GET handler')

    const { res, nextCalls } = invokeLayer(handler)

    assert.deepStrictEqual(res.body, { filePath: 'index.html', options: undefined })
    assert.strictEqual(res.ended, true)
    assert.deepStrictEqual(nextCalls, [])
  })

  it('serves the public index page from GET /', async () => {
    const app = express()
    app.use(indexRouter)

    const response = await request(app).get('/')

    assert.strictEqual(response.statusCode, 200)
    assert.match(response.headers['content-type'], /^text\/html/)
    assert.match(response.text, /RERUM/i)
  })

  it('returns the advertised endpoint map for GET /api', async () => {
    const app = express()
    app.use(apiRoutesRouter)

    const response = await request(app).get('/api')

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.message, 'Welcome to v1 in nodeJS!  Below are the available endpoints, used like /v1/api/{endpoint}')
    assert.deepStrictEqual(response.body.endpoints, {
      '/create': 'POST - Create a new object.',
      '/update': 'PUT - Update the body an existing object.',
      '/patch': 'PATCH - Update the properties of an existing object.',
      '/set': 'PATCH - Update the body an existing object by adding a new property.',
      '/unset': 'PATCH - Update the body an existing object by removing an existing property.',
      '/delete': 'DELETE - Mark an object as deleted.',
      '/query': 'POST - Supply a JSON object to match on, and query the db for an array of matches.',
      '/release': 'POST - Lock a JSON object from changes and guarantee the content and URI.',
      '/overwrite': 'POST - Update a specific document in place, overwriting the existing body.'
    })
  })
})
