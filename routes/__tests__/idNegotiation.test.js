import { it } from 'node:test'
import assert from 'node:assert/strict'
import controller from '../../db-controller.js'

it("Functional '@id-id' negotiation on objects returned.", async () => {
  let negotiate = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    "_id": "example",
    "@id": `${process.env.RERUM_ID_PREFIX}example`,
    "test": "item"
  }
  negotiate = controller.idNegotiation(negotiate)
  assert.strictEqual(negotiate._id, undefined)
  assert.strictEqual(negotiate["@id"], undefined)
  assert.strictEqual(negotiate.id, `${process.env.RERUM_ID_PREFIX}example`)
  assert.strictEqual(negotiate.test, "item")

  let nonegotiate = {
    "@context":"http://example.org/context.json",
    "_id": "example",
    "@id": `${process.env.RERUM_ID_PREFIX}example`,
    "id": "test_example",
    "test":"item"
  }
  nonegotiate = controller.idNegotiation(nonegotiate)
  assert.strictEqual(nonegotiate._id, undefined)
  assert.strictEqual(nonegotiate["@id"], `${process.env.RERUM_ID_PREFIX}example`)
  assert.strictEqual(nonegotiate.id, "test_example")
  assert.strictEqual(nonegotiate.test, "item")
})
