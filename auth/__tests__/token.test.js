import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

import auth from '../../auth/index.js'

const originalReadonly = process.env.READONLY
const originalBotAgent = process.env.BOT_AGENT
const originalAgentClaim = process.env.RERUM_AGENT_CLAIM

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    send(payload) {
      this.body = payload
      return this
    }
  }
}

function makeRequest(authorizationHeaderValue) {
  return {
    header(name) {
      return name.toLowerCase() === 'authorization' ? authorizationHeaderValue : undefined
    }
  }
}

function makeBearer(payload, header = { alg: 'RS256', typ: 'JWT' }) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `Bearer ${encodedHeader}.${encodedPayload}.fake-signature`
}

afterEach(() => {
  process.env.READONLY = originalReadonly
  process.env.BOT_AGENT = originalBotAgent
  process.env.RERUM_AGENT_CLAIM = originalAgentClaim
  mock.restoreAll()
})

describe('auth middleware helpers', () => {
  it('exports the expected checkJwt middleware pipeline order', () => {
    assert.strictEqual(auth.checkJwt.length, 4)
    assert.strictEqual(auth.checkJwt[0], auth.READONLY)
  })

  it('READONLY blocks writes when the server is in readonly mode', () => {
    process.env.READONLY = 'true'
    const response = createResponse()
    let nextCalled = false

    auth.READONLY({}, response, () => {
      nextCalled = true
    })

    assert.strictEqual(nextCalled, false)
    assert.strictEqual(response.statusCode, 503)
    assert.match(response.body.message, /read only/i)
  })

  it('READONLY passes through when the server is writable', () => {
    process.env.READONLY = 'false'
    const response = createResponse()
    let nextCalled = false

    auth.READONLY({}, response, () => {
      nextCalled = true
    })

    assert.strictEqual(nextCalled, true)
    assert.strictEqual(response.body, undefined)
  })

  it('isBot matches the configured bot claim', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'
    process.env.BOT_AGENT = 'https://store.rerum.io/v1/id/bot-agent'

    const result = auth.isBot({
      'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/bot-agent'
    })

    assert.strictEqual(result, true)
  })

  it('isBot returns false for a non-bot agent claim', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'
    process.env.BOT_AGENT = 'https://store.rerum.io/v1/id/bot-agent'

    const result = auth.isBot({
      'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/some-other-user'
    })

    assert.strictEqual(result, false)
  })

  // Regression guard for the defensive check at auth/index.js:169. Without it,
  // an unset BOT_AGENT made `undefined === undefined` true and bypassed auth
  // for any invalid-token request whose payload was missing the agent claim.
  it('isBot returns false when BOT_AGENT is unset', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'
    delete process.env.BOT_AGENT

    assert.strictEqual(auth.isBot({}), false)
    assert.strictEqual(auth.isBot({ unknownClaim: 'x' }), false)
    assert.strictEqual(auth.isBot({ 'http://store.rerum.io/agent': 'anyone' }), false)
  })

  it('isGenerator matches the generating agent claim', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'

    const result = auth.isGenerator(
      { __rerum: { generatedBy: 'https://store.rerum.io/v1/id/agent007' } },
      { 'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/agent007' }
    )

    assert.strictEqual(result, true)
  })
})

describe('_tokenError (checkJwt[2])', () => {
  const _tokenError = auth.checkJwt[2]

  it('forwards non-invalid_token errors unchanged', () => {
    const err = Object.assign(new Error('something else broke'), { code: 'something_else' })
    let received = 'not-called'
    _tokenError(err, makeRequest('Bearer a.b.c'), createResponse(), (e) => { received = e })
    assert.strictEqual(received, err)
  })

  it('forwards invalid_token errors when the agent is not a bot', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'
    process.env.BOT_AGENT = 'https://store.rerum.io/v1/id/bot-agent'
    const err = { code: 'invalid_token', message: 'signature verification failed' }
    const req = makeRequest(makeBearer({
      'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/regular-user'
    }))
    let received = 'not-called'
    _tokenError(err, req, createResponse(), (e) => { received = e })
    assert.strictEqual(received, err)
  })

  it('bypasses invalid_token errors when the agent matches BOT_AGENT', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'
    process.env.BOT_AGENT = 'https://store.rerum.io/v1/id/bot-agent'
    const err = { code: 'invalid_token', message: 'token expired' }
    const req = makeRequest(makeBearer({
      'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/bot-agent'
    }))
    let received = 'not-called'
    _tokenError(err, req, createResponse(), (e) => { received = e })
    assert.strictEqual(received, undefined, 'bot bypass should call next() with no arg')
  })
})

describe('_extractUser (checkJwt[3])', () => {
  const _extractUser = auth.checkJwt[3]

  it('decodes the JWT payload into req.user', () => {
    const payload = {
      'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/agent007',
      sub: 'user-x'
    }
    const req = makeRequest(makeBearer(payload))
    let nextCalled = false
    let receivedError
    _extractUser(req, createResponse(), (e) => {
      nextCalled = true
      receivedError = e
    })
    assert.strictEqual(nextCalled, true)
    assert.strictEqual(receivedError, undefined)
    assert.deepStrictEqual(req.user, payload)
  })

  it('returns a 401 error when the Authorization header is malformed', () => {
    const req = makeRequest('Bearer not-a-jwt')
    let received
    _extractUser(req, createResponse(), (e) => { received = e })
    assert.ok(received, 'next should be called with an error')
    assert.strictEqual(received.status, 401)
    assert.strictEqual(received.statusCode, 401)
  })
})

describe('auth token refresh helpers', () => {
  it('generateNewAccessToken returns the Auth0 payload on success', async () => {
    process.env.CLIENT_ID = 'client-id'
    process.env.CLIENT_SECRET = 'client-secret'
    process.env.RERUM_PREFIX = 'https://store.rerum.io/v1'

    mock.method(globalThis, 'fetch', async () => ({
      async json() {
        return {
          access_token: 'access-token',
          refresh_token: 'refresh-token'
        }
      }
    }))

    const response = createResponse()
    await auth.generateNewAccessToken({ body: { refresh_token: 'incoming-refresh-token' } }, response)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.access_token, 'access-token')
  })

  it('generateNewAccessToken returns 500 for Auth0 error payloads', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      async json() {
        return {
          error: true,
          error_description: 'bad refresh token'
        }
      }
    }))

    const response = createResponse()
    await auth.generateNewAccessToken({ body: { refresh_token: 'bad-token' } }, response)

    assert.strictEqual(response.statusCode, 500)
    assert.strictEqual(response.body, 'bad refresh token')
  })
})
