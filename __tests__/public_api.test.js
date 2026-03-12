import { app, createServer, start } from '../index.js'

describe('public API entry point', () => {
  test('exports an express app instance', () => {
    expect(app).toBeDefined()
    expect(typeof app.use).toBe('function') // express app
  })

  test('createServer returns a http.Server', () => {
    const server = createServer(0) // port 0 for ephemeral
    expect(server).toBeDefined()
    expect(typeof server.listen).toBe('function')
    server.close()
  })

  test('start starts the server and returns it', (done) => {
    const server = start(0)
    server.on('listening', () => {
      server.close(() => done())
    })
  })
})
