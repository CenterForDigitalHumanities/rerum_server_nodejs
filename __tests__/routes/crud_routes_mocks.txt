/**
 * @author bhaberbe
 * */

let request = require("supertest")
let app = require('../../app')
const nock = require('nock')
request = request("http://localhost:3333")

require("../../__mocks__/id")
it('Mocks /v1/id/abcde request.  Should return a JSON object with "_id" abcde.  Should include Location header.', function(done){
  request
    .get('/v1/id/abcde')
    .expect(200)
    .then(response => {
      expect(response.header["location"]).toBeTruthy()
      expect(response.body["@id"]).toBeTruthy()
      done()
    })
    .catch(err => done(err))
})
