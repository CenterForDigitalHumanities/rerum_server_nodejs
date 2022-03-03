let request = require("supertest")
//All on one host.  If not, do not use this and use request(app) syntax instead.

//Fun fact, if you don't require app, you don't get coverage. 
let app = require('../app')

//A super fun note.  If you do request(app), the tests will fail due to race conditions.  
//client.connect() in db-controller.js will not finish before some calls to the routes.  So strange.
//request = request(app)
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
