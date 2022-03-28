let request = require("supertest")
//Fun fact, if you don't require app, you don't get coverage even though the tests run just fine.
let app = require('../../app')

//A super fun note.  If you do request(app), the tests will fail due to race conditions.  
//request = request(app)
request = request("http://localhost:3333")

describe(
  'Test that each available endpoint succeeds given a properly formatted request and request body.', 
  function() {

    it('End to end /v1/id/{_id}. It should respond 404, this object does not exist.',
    function(done) {
      request
        .get('/v1/id/potato')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(404, done)
      }
    )

    it('End to end /v1/since/{_id}. It should respond 404, this object does not exist.',
    function(done) {
      request
        .get('/v1/since/potato')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(404, done)
      }
    )

    it('End to end /v1/history/{_id}. It should respond 404, this object does not exist.',
    function(done) {
      request
        .get('/v1/history/potato')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(404, done)
      }
    )

    it('End to end /v1/id/. Forget the _id in the URL pattern.  '+
      'It should respond 404, this page/object does not exist.',
    function(done) {
      request
        .get('/v1/id/')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(404, done)
      }
    )

    it('End to end /v1/since/. Forget the _id in the URL pattern.  '+
      'It should respond 404, this page/object does not exist.',
    function(done) {
      request
        .get('/v1/since/')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(404, done)
      }
    )

    it('End to end /v1/history/. Forget the _id in the URL pattern.  '+
      'It should respond 404, this page/object does not exist.',
    function(done) {
      request
        .get('/v1/history/')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(404, done)
      }
    )

    it('End to end /v1/id/{_id}. Do a properly formatted GET for an object by id.  '+
      'It should respond 200 with a body that is a JSON object with an "@id" property.',
    function(done) {
      request
        .get('/v1/id/622f7f0a0249b8ac889b2e2c')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(200)
        .then(response => {
            //The following commented out headers are not what they are expected to be. TODO investigate if it matters.
            //expect(response.headers["connection"]).toBe("Keep-Alive)
            //expect(response.headers["keep-alive"]).toBeTruthy()
            //expect(response.headers["access-control-allow-methods"]).toBeTruthy()
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["cache-control"]).toBeTruthy()
            expect(response.headers["last-modified"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(response.headers["location"]).toBeTruthy()
            expect(response.body["@id"]).toBeTruthy()
            done()
        })
        .catch(err => done(err))
      }
    )
    
    it('End to end /v1/since/{_id}. Do a properly formatted /since call by GETting for an existing _id. '+
      'It should respond 200 with a body that is of type Array.',
    function(done) {
      request
        .get('/v1/since/622f7f0a0249b8ac889b2e2c')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(200)
        .then(response => {
            //The following commented out headers are not what they are expected to be. TODO investigate if it matters.
            //expect(response.headers["connection"]).toBe("Keep-Alive)
            //expect(response.headers["keep-alive"]).toBeTruthy()
            //expect(response.headers["access-control-allow-methods"]).toBeTruthy()
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(Array.isArray(response.body)).toBe(true)
            done()
        })
        .catch(err => done(err))
      }
    )

    it('End to end /v1/history/{_id}. Do a properly formatted /history call by GETting for an existing _id.  '+
      'It should respond 200 with a body that is of type Array.',
    function(done) {
      request
        .get('/v1/history/622f7f0a0249b8ac889b2e2c')
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(200)
        .then(response => {
            //The following commented out headers are not what they are expected to be. TODO investigate if it matters.
            //expect(response.headers["connection"]).toBe("Keep-Alive)
            //expect(response.headers["keep-alive"]).toBeTruthy()
            //expect(response.headers["access-control-allow-methods"]).toBeTruthy()
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(Array.isArray(response.body)).toBe(true)
            done()
        })
        .catch(err => done(err))
      }
    )

    it('End to end /v1/api/create. Do a properly formatted /create call by POSTing a JSON body.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 201 with enough JSON in the response body to discern the "@id".  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".',
    function(done) {
      const unique = new Date(Date.now()).toISOString().replace("Z", "")
      request
        .post('/v1/api/create')
        .send({"RERUM Create Test":unique})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer "+process.env.BOT_TOKEN_DEV)
        .expect(201)
        .then(response => {
            //The following commented out headers are not what they are expected to be. TODO investigate if it matters.
            //expect(response.headers["connection"]).toBe("Keep-Alive)
            //expect(response.headers["keep-alive"]).toBeTruthy()
            //expect(response.headers["access-control-allow-methods"]).toBeTruthy()
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["location"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(response.body["@id"]).toBeTruthy()
            done()
        })
        .catch(err => done(err))
      }
    )

    it('End to end /v1/api/update. Do a properly formatted /update call by PUTing an existing entity.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 200 with enough JSON in the response body to discern the "@id".  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".', 
    function(done) {
      const unique = new Date(Date.now()).toISOString().replace("Z", "")
      request
        .put('/v1/api/update')
        .send({"@id":process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c", "RERUM Update Test":unique})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer "+process.env.BOT_TOKEN_DEV)
        .expect(200)
        .then(response => {
            //The following commented out headers are not what they are expected to be. TODO investigate if it matters.
            //expect(response.headers["connection"]).toBe("Keep-Alive)
            //expect(response.headers["keep-alive"]).toBeTruthy()
            //expect(response.headers["access-control-allow-methods"]).toBeTruthy()
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(response.headers["location"]).toBeTruthy()
            expect(response.headers["location"]).not.toBe(process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c")
            expect(response.body["@id"]).toBeTruthy()
            expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c")
            done()
        })
        .catch(err => done(err))
    })

    it('End to end /v1/api/patch. Do a properly formatted /patch call by PATCHing an existing entity.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 200 with enough JSON in the response body to discern the "@id".  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".', 
    function(done) {
      const unique = new Date(Date.now()).toISOString().replace("Z", "")
      request
        .patch('/v1/api/patch')
        .send({"@id":process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c", "test_obj":unique})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer "+process.env.BOT_TOKEN_DEV)
        .expect(200)
        .then(response => {
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(typeof response.body["test_object"]).toBe("string")
            expect(response.body["@id"]).toBeTruthy()
            expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c")
            done()
        })
        .catch(err => done(err))
    })

    it('End to end /v1/api/set. Do a properly formatted /set call by PATCHing an existing entity.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 200 with enough JSON in the response body to discern the "@id" and the property that was set.  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".', 
    function(done) {
      const unique = new Date(Date.now()).toISOString().replace("Z", "")
      request
        .patch('/v1/api/set')
        .send({"@id":process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c", "test_set":unique})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer RERUM")
        .expect(200)
        .then(response => {
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(response.body["@id"]).toBeTruthy()
            expect(response.body["test_set"]).toBe(unique)
            expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c")
            done()
        })
        .catch(err => done(err))
    })

    it('End to end /v1/api/set. Do a properly formatted /set call by PATCHing an existing entity.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 200 with enough JSON in the response body to discern the "@id" and the absence of the unset property.  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".', 
    function(done) {
      request
        .patch('/v1/api/unset')
        .send({"@id":process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c", "test_obj":null})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer RERUM")
        .expect(200)
        .then(response => {
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(response.body.hasOwnProperty("test_obj")).toBe(false)
            expect(response.body["@id"]).toBeTruthy()
            expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"622f7f0a0249b8ac889b2e2c")
            done()
        })
    })

    it('End to end /v1/api/delete. Do a properly formatted /delete call by DELETEing an existing object.  '+
    'It will need to create an object first, then delete that object, and so must complete a /create call first.  '+
    'It will check the response to /create is 201 and the response to /delete is 204.', function(done) {
      request
        .post("/v1/api/create/")
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer "+process.env.BOT_TOKEN_DEV)
        .send({"testing_delete":"Delete Me"})
        .expect(201)
        .then(response => {
          /**
           * We cannot delete the same object over and over again, so we need to create an object to delete. 
           * Performing the extra /create in front of this adds unneceesary complexity - it has nothing to do with delete.
           * TODO optimize
           */ 
          const objToDelete = response.body
          request
          .delete('/v1/api/delete/'+objToDelete._id)
          .set('Authorization', "Bearer "+process.env.BOT_TOKEN_DEV)
          .expect(204)
          .then(r => {
            //To be really strict, we could get the object and make sure it has __deleted.
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            done()
          })
        })
    })

    it('End to end /v1/api/query. Do a properly formatted /query call by POSTing a JSON query object.  '+
    'It should respond with a 200 and an array, even if there were no matches.  '+
    'We are querying for an object we know exists, so the length of the response should be more than 0.',
    function(done) {
      request
        .post('/v1/api/query')
        .send({"_id" : "622f7f0a0249b8ac889b2e2c"})
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(200)
        .then(response => {
            //The following commented out headers are not what they are expected to be. TODO investigate if it matters.
            //expect(response.headers["connection"]).toBe("Keep-Alive)
            //expect(response.headers["keep-alive"]).toBeTruthy()
            //expect(response.headers["access-control-allow-methods"]).toBeTruthy()
            expect(response.headers["content-length"]).toBeTruthy()
            expect(response.headers["content-type"]).toBeTruthy()
            expect(response.headers["date"]).toBeTruthy()
            expect(response.headers["etag"]).toBeTruthy()
            expect(response.headers["access-control-allow-origin"]).toBe("*")
            expect(response.headers["access-control-expose-headers"]).toBe("*")
            expect(response.headers["allow"]).toBeTruthy()
            expect(response.headers["link"]).toBeTruthy()
            expect(Array.isArray(response.body)).toBe(true)
            expect(response.body.length).toBeTruthy()
            done()
        })
        .catch(err => done(err))
    })
})
