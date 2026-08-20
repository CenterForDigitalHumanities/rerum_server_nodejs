import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

routeTester.use("/id/:_id/expanded", controller.idExpanded)

// Mount our own /id route without auth, matching routes/id.js: GET only, no HEAD handler.
routeTester.use("/id/:_id", controller.id)

const MOCK_AGENT = "https://store.rerum.io/v1/id/agent007"
const MOCK_PREFIX = "https://store.rerum.io/v1/id/"
const MOCK_ID = "testid123"

const mockDoc = {
  _id: MOCK_ID,
  "@id": `${MOCK_PREFIX}${MOCK_ID}`,
  test: "item",
  __rerum: {
    generatedBy: MOCK_AGENT,
    history: { prime: "root", previous: "", next: [] },
    isReleased: "",
    isOverwritten: "",
    releases: { previous: "", next: [], replaces: "" },
    createdAt: "2025-01-01T00:00:00.000"
  }
}

// Import db mock so we can configure per-test behaviour
import { db, resetMocks, createCursor } from '../../database/index.js'

beforeEach(() => {
  resetMocks()
})

it("'/id/:id' route functions", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  const response = await request(routeTester).get(`/id/${MOCK_ID}`)

  assert.strictEqual(response.statusCode, 200)
  assert.ok(response.body["@id"] ?? response.body.id)
  assert.strictEqual(response.body._id, undefined)
  assert.ok(response.body.__rerum)
})

describe('HEAD /id/:id', () => {
  it("returns 200 with Content-Length matching the GET body length", async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const getResp = await request(routeTester).get(`/id/${MOCK_ID}`)
    const getLen = Number(getResp.headers['content-length'])

    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const headResp = await request(routeTester).head(`/id/${MOCK_ID}`)

    assert.strictEqual(headResp.statusCode, 200)
    assert.ok(getLen > 0, 'GET must report a Content-Length')
    assert.strictEqual(Number(headResp.headers['content-length']), getLen)
    // HEAD must not carry a body.
    assert.ok(!headResp.body || Object.keys(headResp.body).length === 0)
  })

  it("returns 404 when the object is not in RERUM", async () => {
    db.findOne.mockResolvedValueOnce(null)
    const response = await request(routeTester).head(`/id/${MOCK_ID}`)
    assert.strictEqual(response.statusCode, 404)
  })

  // RFC 9110 s9.3.2: HEAD sends the same headers a GET would.
  it("sends the same headers as the GET, including the validators", async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const getResp = await request(routeTester).get(`/id/${MOCK_ID}`)

    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const headResp = await request(routeTester).head(`/id/${MOCK_ID}`)

    assert.strictEqual(headResp.headers['cache-control'], 'max-age=86400, must-revalidate')
    assert.ok(headResp.headers['last-modified'], 'HEAD must report Last-Modified')
    assert.ok(headResp.headers['etag'], 'HEAD must report an ETag to validate against')
    for (const header of ['cache-control', 'last-modified', 'etag', 'content-type',
      'link', 'allow', 'current-overwritten-version', 'location']) {
      assert.strictEqual(headResp.headers[header], getResp.headers[header],
        `HEAD and GET must agree on ${header}`)
    }
  })

  it("reports Last-Modified from the overwrite time once an object has been overwritten", async () => {
    const overwritten = structuredClone(mockDoc)
    overwritten.__rerum.isOverwritten = '2025-06-24T10:00:00'
    db.findOne.mockResolvedValueOnce(overwritten)

    const response = await request(routeTester).head(`/id/${MOCK_ID}`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['last-modified'], new Date('2025-06-24T10:00:00').toUTCString())
    assert.strictEqual(response.headers['current-overwritten-version'], '2025-06-24T10:00:00')
  })
})

describe('id route overwrite headers', () => {
  it('includes the current overwrite version header for existing objects', async () => {
    const overwritten = structuredClone(mockDoc)
    overwritten.__rerum.isOverwritten = '2025-06-24T10:00:00'
    db.findOne.mockResolvedValueOnce(overwritten)

    const response = await request(routeTester).get(`/id/${MOCK_ID}`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['current-overwritten-version'], '2025-06-24T10:00:00')
  })

  it('uses an empty overwrite version header for never-overwritten objects', async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))

    const response = await request(routeTester).get(`/id/${MOCK_ID}`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['current-overwritten-version'], '')
  })
})

// Fixtures for GET|POST /id/:_id/expanded.
const EXPAND_ID = "expandme123"
const EXPAND_URI = `${MOCK_PREFIX}${EXPAND_ID}`
const EVIL_URI = "https://evil.example.org/hijacked"

const expandableDoc = {
  _id: EXPAND_ID,
  "@id": EXPAND_URI,
  "@context": "http://www.loc.gov/mods",
  "@type": "named-gloss",
  title: "A Gloss",
  __rerum: {
    generatedBy: MOCK_AGENT,
    history: { prime: "root", previous: "", next: [] },
    isReleased: "",
    isOverwritten: "",
    releases: { previous: "", next: [], replaces: "" },
    createdAt: "2025-01-01T00:00:00.000"
  }
}

let annoCount = 0

/**
 * Build a leaf Annotation targeting the expandable record.  Each one needs its own '_id' because
 * findLeafAnnotationsFor() sorts on it before dropping it, which fixes the merge order.
 *
 * @param props The Annotation properties under test, usually a body.
 * @return An Annotation document.
 */
function anno(props) {
  annoCount++
  return {
    _id: `anno${String(annoCount).padStart(3, "0")}`,
    type: "Annotation",
    target: EXPAND_URI,
    ...props
  }
}

// The MongoDB filter the controller built for the last expansion, or undefined when it never queried.
let capturedQuery

/**
 * Arm the database double for a single /expanded request.
 *
 * @param record The document db.findOne() will answer with.
 * @param annos The Annotation documents the cursor will yield.
 */
function armExpansion(record, annos = []) {
  capturedQuery = undefined
  db.findOne.mockResolvedValueOnce(structuredClone(record))
  db.find.mockImplementationOnce(query => {
    capturedQuery = query
    return createCursor(annos)
  })
}

describe('GET /id/:id/expanded', () => {
  it("'/id/:id/expanded' route functions", async () => {
    armExpansion(expandableDoc, [anno({ body: { subject: "history" } })])

    const response = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body["@id"], EXPAND_URI)
    assert.strictEqual(response.body.subject, "history")
    assert.strictEqual(response.body._id, undefined)
    assert.strictEqual(Object.keys(response.body).at(-1), '__rerum', '__rerum stays last')
    assert.strictEqual(response.headers['annotations-gathered'], '1')
    assert.strictEqual(response.headers['annotations-merged'], '1')
    assert.strictEqual(response.headers['cache-control'], 'max-age=86400, must-revalidate')
    assert.strictEqual(response.headers['current-overwritten-version'], '')

    // A container-typed record gets the Web Annotation Link header, including when its type is
    // serialized as a JSON-LD Array.
    const container = structuredClone(expandableDoc)
    container["@type"] = ["Manifest", "AnnotationPage"]
    armExpansion(container, [])
    const containerResp = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)
    assert.match(containerResp.headers.link, /anno\.jsonld/)

    db.findOne.mockResolvedValueOnce(null)
    const missResp = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)
    assert.strictEqual(missResp.statusCode, 404, 'a record that is not in RERUM has no expansion')
  })

  it('merges the anticipated body formats, collecting collisions into an Array', async () => {
    const textualBody = { type: "TextualBody", value: "bare spelling", format: "text/plain", language: "en" }
    const prefixedBody = { "@type": "oa:TextualBody", value: "oa spelling" }
    const arrayTypedBody = { type: ["TextualBody"], value: "Array-typed spelling" }
    const gathered = [
      anno({ body: { subject: "history" } }),
      anno({ body: [{ era: "medieval" }] }),
      anno({ bodyValue: "the W3C shorthand" }),
      anno({ body: textualBody }),
      anno({ body: prefixedBody }),
      anno({ body: [arrayTypedBody] }),
      anno({ body: { title: "An Annotated Title" } }),
      anno({ body: { colors: ["red", "blue"] } }),
      anno({ body: { colors: ["black"] } })
    ]
    // The query plan promises no order, so hand them over reversed.  The expansion sorts by '_id'
    // before merging, which is what makes the assembled entity reproducible.
    armExpansion(expandableDoc, [...gathered].reverse())

    const response = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    assert.strictEqual(response.body.subject, "history", 'a single-key body merges as a raw value')
    assert.strictEqual(response.body.era, "medieval", 'a one-element Array is the same body unwrapped')
    // A TextualBody is kept whole so its format and language survive, whatever the type spelling.
    assert.deepStrictEqual(response.body.bodyValue,
      ["the W3C shorthand", textualBody, prefixedBody, arrayTypedBody])
    assert.deepStrictEqual(response.body.title, ["A Gloss", "An Annotated Title"], 'the record value comes first')
    assert.deepStrictEqual(response.body.colors, ["red", "blue", "black"], 'Array contributions flatten')
  })

  it('does not merge Annotations that make no single assertion', async () => {
    armExpansion(expandableDoc, [
      anno({ body: [{ first: "one" }, { second: "two" }] }),
      anno({ body: { subject: "history", note: "extra" } }),
      anno({ body: "https://store.rerum.io/v1/id/an-external-body" }),
      anno({ motivation: "bookmarking" }),
      anno({ body: { merged: "yes" } })
    ])

    const response = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    for (const key of ['first', 'second', 'subject', 'note', 'motivation']) {
      assert.strictEqual(response.body[key], undefined, `${key} must not be merged`)
    }
    assert.strictEqual(response.body.merged, "yes")
    assert.strictEqual(response.headers['annotations-gathered'], '5')
    assert.strictEqual(response.headers['annotations-merged'], '1', 'only the contributing Annotation counts')
  })

  it('never lets an Annotation body overwrite identity or system properties', async () => {
    armExpansion(expandableDoc, [
      anno({ body: { "@id": EVIL_URI } }),
      anno({ body: { id: EVIL_URI } }),
      anno({ body: { _id: "evil-id" } }),
      anno({ body: { __rerum: { evil: true } } }),
      anno({ body: { __deleted: { time: "2025-01-01T00:00:00.000" } } }),
      anno({ body: { "@context": "https://evil.example.org/context.json" } }),
      // An object literal with a __proto__ key sets the prototype instead of creating an own
      // property.  JSON.parse creates the own property, which is what a MongoDB document has.
      anno({ body: JSON.parse('{"__proto__":{"polluted":"yes"}}') })
    ])

    const response = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    assert.strictEqual(response.body["@id"], EXPAND_URI)
    assert.strictEqual(response.body.id, undefined)
    assert.strictEqual(response.body._id, undefined)
    assert.strictEqual(response.body.__rerum.evil, undefined)
    assert.strictEqual(response.body.__rerum.generatedBy, MOCK_AGENT)
    assert.strictEqual(response.body.__deleted, undefined)
    assert.strictEqual(response.body["@context"], "http://www.loc.gov/mods")
    assert.strictEqual(Object.hasOwn(response.body, '__proto__'), false)
    assert.strictEqual({}.polluted, undefined, 'Object.prototype must not be polluted')
    assert.strictEqual(response.headers['annotations-merged'], '0')
  })

  it('gathers Annotations that target the record by its Slug', async () => {
    const slugged = structuredClone(expandableDoc)
    slugged.__rerum.slug = "my-slug"
    armExpansion(slugged, [])

    await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    const exactTargets = capturedQuery.$and[0].$or
      .filter(condition => typeof condition.target === "string")
      .map(condition => condition.target)
    assert.ok(exactTargets.includes(EXPAND_URI), 'the _id URI must be targeted')
    assert.ok(exactTargets.includes(`${MOCK_PREFIX}my-slug`), 'the slug URI must be targeted too')
  })

  it('returns the tombstone unexpanded for a deleted record', async () => {
    const deletedDoc = structuredClone(expandableDoc)
    deletedDoc.__deleted = { time: "2025-01-01T00:00:00.000", deletor: MOCK_AGENT }
    armExpansion(deletedDoc, [anno({ body: { subject: "history" } })])

    const response = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    assert.strictEqual(response.statusCode, 200)
    assert.ok(response.body.__deleted)
    assert.strictEqual(response.body.subject, undefined)
    assert.strictEqual(response.headers['annotations-gathered'], '0')
    assert.strictEqual(capturedQuery, undefined, 'a deleted record is not queried for Annotations')
  })

  it('filters the expansion by the generator and creator parameters', async () => {
    armExpansion(expandableDoc, [])

    await request(routeTester).get(`/id/${EXPAND_ID}/expanded?generator=${MOCK_AGENT}&creator=Fred`)

    // $and[0] is the target condition and $and[1] the Annotation type condition.
    assert.deepStrictEqual(capturedQuery.$and.slice(2), [
      {
        $or: [
          { "__rerum.generatedBy": MOCK_AGENT.replace(/^https/, "http") },
          { "__rerum.generatedBy": MOCK_AGENT }
        ]
      },
      { creator: "Fred" }
    ])

    armExpansion(expandableDoc, [])
    await request(routeTester).get(`/id/${EXPAND_ID}/expanded?generator=one&generator=two&creator=&limit=5`)
    assert.deepStrictEqual(capturedQuery.$and.slice(2), [],
      'repeated, empty, and unrelated parameters are not filters')
  })
})

describe('POST /id/:id/expanded', () => {
  it('reads literal filter keys from the body and ignores the ones the endpoint owns', async () => {
    armExpansion(expandableDoc, [])

    const response = await request(routeTester)
      .post(`/id/${EXPAND_ID}/expanded?generator=${MOCK_AGENT}`)
      .set('Content-Type', 'application/json')
      .send({
        target: EVIL_URI,
        "target.id": EVIL_URI,
        type: "Dataset",
        "@type": "Dataset",
        "__rerum.history": { next: [] },
        "__rerum.history.next": { $size: 3 },
        motivation: "describing"
      })

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(capturedQuery.$and.slice(2), [{ motivation: "describing" }],
      'the reserved keys and the URL parameters are not filters')
    assert.strictEqual(response.headers['cache-control'], undefined,
      'a filtered read is not browser-cacheable')
  })

  it('expands unfiltered when no body is supplied', async () => {
    armExpansion(expandableDoc, [anno({ body: { subject: "history" } })])

    const response = await request(routeTester).post(`/id/${EXPAND_ID}/expanded`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.subject, "history")
    assert.deepStrictEqual(capturedQuery.$and.slice(2), [])
  })

  it('returns 400 when the body is not a filter object', async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(expandableDoc))

    const response = await request(routeTester)
      .post(`/id/${EXPAND_ID}/expanded`)
      .set('Content-Type', 'application/json')
      .send([{ motivation: "describing" }])

    assert.strictEqual(response.statusCode, 400)
  })
})

// RFC 9110 s9.3.2: HEAD sends the same headers a GET would.
describe('HEAD /id/:id/expanded', () => {
  it('sends the same headers and Content-Length as the GET, with no body', async () => {
    armExpansion(expandableDoc, [anno({ body: { subject: "history" } })])
    const getResp = await request(routeTester).get(`/id/${EXPAND_ID}/expanded`)

    armExpansion(expandableDoc, [anno({ body: { subject: "history" } })])
    const headResp = await request(routeTester).head(`/id/${EXPAND_ID}/expanded`)

    assert.strictEqual(headResp.statusCode, 200)
    assert.ok(Number(getResp.headers['content-length']) > 0, 'GET must report a Content-Length')
    assert.strictEqual(headResp.headers['content-length'], getResp.headers['content-length'])
    assert.ok(headResp.headers['etag'], 'HEAD must report an ETag to validate against')
    for (const header of ['cache-control', 'etag', 'content-type', 'link', 'allow',
      'current-overwritten-version', 'location', 'annotations-gathered', 'annotations-merged']) {
      assert.strictEqual(headResp.headers[header], getResp.headers[header],
        `HEAD and GET must agree on ${header}`)
    }
    assert.ok(!headResp.body || Object.keys(headResp.body).length === 0)
  })
})
