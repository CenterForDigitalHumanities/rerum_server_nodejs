let request = require("supertest")
//const app = require("../app")
request = request("http://localhost:3333")
describe("Get the app index.  This is a check for life, is there a heartbeat?", ()=>{
    it('http://{server}:{port}/ -- Server index.  HTML page with with Express "hello world". ', function(done) {
    request
      .get('/')
      .expect('Content-Type', /html/)
      .expect('X-Powered-By', 'Express')
      .expect(200, done)
  })
})


