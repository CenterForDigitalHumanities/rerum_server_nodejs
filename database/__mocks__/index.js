/**
 * Native test mock for database/index.js.
 * Exposes a small mock-function surface used by the node:test suites.
 */

const registeredMocks = new Set()

function createMockFunction(implementation = () => undefined) {
  const onceQueue = []
  let currentImplementation = implementation

  function fn(...args) {
    const activeImplementation = onceQueue.length > 0 ? onceQueue.shift() : currentImplementation
    return activeImplementation.apply(this, args)
  }

  fn.mockImplementation = (nextImplementation) => {
    currentImplementation = nextImplementation
    return fn
  }
  fn.mockImplementationOnce = (nextImplementation) => {
    onceQueue.push(nextImplementation)
    return fn
  }
  fn.mockReturnValue = (value) => fn.mockImplementation(() => value)
  fn.mockReturnValueOnce = (value) => fn.mockImplementationOnce(() => value)
  fn.mockResolvedValue = (value) => fn.mockImplementation(() => Promise.resolve(value))
  fn.mockResolvedValueOnce = (value) => fn.mockImplementationOnce(() => Promise.resolve(value))
  fn.mockRejectedValue = (value) => fn.mockImplementation(() => Promise.reject(value))
  fn.mockRejectedValueOnce = (value) => fn.mockImplementationOnce(() => Promise.reject(value))
  fn.mockReturnThis = () => fn.mockImplementation(function () { return this })
  fn.mockReset = () => {
    onceQueue.length = 0
    currentImplementation = () => undefined
    return fn
  }

  registeredMocks.add(fn)
  return fn
}

function createCursor() {
  return {
    limit: createMockFunction(function () { return this }),
    skip: createMockFunction(function () { return this }),
    toArray: createMockFunction(() => Promise.resolve([]))
  }
}

const defaultBulkWriteResponse = () => ({
  result: { insertedIds: [{ _id: 'bulkid1' }, { _id: 'bulkid2' }] },
  insertedIds: {},
  insertedCount: 0
})

export function resetMocks() {
  for (const fn of registeredMocks) {
    fn.mockReset()
  }

  db.findOne.mockResolvedValue(null)
  db.find.mockReturnValue(createCursor())
  db.insertOne.mockResolvedValue({ insertedId: 'testid123' })
  db.replaceOne.mockResolvedValue({ modifiedCount: 1 })
  db.countDocuments.mockResolvedValue(0)
  db.bulkWrite.mockResolvedValue(defaultBulkWriteResponse())
  db.deleteOne.mockResolvedValue({ deletedCount: 1 })
  db.updateOne.mockResolvedValue({ modifiedCount: 1 })
  db.findOneAndUpdate.mockResolvedValue({ value: null })
  newID.mockReturnValue('testid123')
  isValidID.mockReturnValue(false)
  connected.mockResolvedValue(true)
}

export const db = {
  findOne: createMockFunction(() => Promise.resolve(null)),
  find: createMockFunction(() => createCursor()),
  insertOne: createMockFunction(() => Promise.resolve({ insertedId: 'testid123' })),
  replaceOne: createMockFunction(() => Promise.resolve({ modifiedCount: 1 })),
  countDocuments: createMockFunction(() => Promise.resolve(0)),
  bulkWrite: createMockFunction(() => Promise.resolve(defaultBulkWriteResponse())),
  deleteOne: createMockFunction(() => Promise.resolve({ deletedCount: 1 })),
  updateOne: createMockFunction(() => Promise.resolve({ modifiedCount: 1 })),
  findOneAndUpdate: createMockFunction(() => Promise.resolve({ value: null }))
}

export const newID = createMockFunction(() => 'testid123')
export const isValidID = createMockFunction(() => false)
export const connected = createMockFunction(() => Promise.resolve(true))

resetMocks()
