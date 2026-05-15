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

  it('isGenerator matches the generating agent claim', () => {
    process.env.RERUM_AGENT_CLAIM = 'http://store.rerum.io/agent'

    const result = auth.isGenerator(
      { __rerum: { generatedBy: 'https://store.rerum.io/v1/id/agent007' } },
      { 'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/agent007' }
    )

    assert.strictEqual(result, true)
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
