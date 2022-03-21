let request = require("supertest")
let app = require('../../app')
const nock = require('nock')
request = request("http://mock.rerum.io")

//Set up the handler for a mock /v1/id/{_id} request
nock('http://mock.rerum.io')
.get('/v1/id/abcde')
.reply(200, 
  {
    "_id":"abcde",
    "__rerum":{},
    "@id":"abcde"
  },
  {
    "Location" : "http://mock.rerum.io/v1/id/abcde"
  }
)

describe('unit testing /v1/id/{_id} route with a MOCK', function() {
  it('should return the expected json response', function(done){
      request
        .get('/v1/id/abcde')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(200)
        .then(response => {
            expect(response.headers["location"]).toBeTruthy()
            expect(response.body["@id"]).toBeTruthy()
            done()
        })
        .catch(err => done(err))
  })
})