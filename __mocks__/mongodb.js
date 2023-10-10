export const constructorSpy = jest.fn()

export class MongoClient {
  constructor(url, options) {
    constructorSpy(url, options)
  }

  async connect() {
    return 'mock-client'
  }
}
