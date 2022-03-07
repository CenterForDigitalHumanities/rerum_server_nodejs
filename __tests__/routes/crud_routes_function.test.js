let request = require("supertest")

//Fun fact, if you don't require app, you don't get coverage even though the tests run just fine.
let app = require('../../app')

//A super fun note.  If you do request(app), the tests will fail due to race conditions.  
//client.connect() in db-controller.js will not finish before some calls to the routes.  So strange.
//request = request(app)
request = request("http://localhost:3333")

describe(
  'Test that each available endpoint succeeds given a properly formatted request and request body.', 
  function() {
    
    it('End to end /v1/api/create. Do a properly formatted /create call by POSTing a JSON body.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 201 with enough JSON in the response body to discern the "@id".  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".',
    function(done) {
      request
        .post('/v1/api/create')
        .send({"RERUM Create Test" : new Date(Date.now()).toISOString().replace("Z", "")})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer "+process.env.bot_token_dev)
        .expect(201)
        .then(response => {
            expect(response.body["@id"]).toBeTruthy()
            done()
        })
        .catch(err => done(err))
      }
    )

    //TODO add a reliable test object here, perhaps '11111'
    it('End to end /v1/api/update. Do a properly formatted /update call by PUTing an existing entity.  '+
    'The Authorization header is set, it is an access token encoded with the bot.  '+
    'It should respond with a 200 with enough JSON in the response body to discern the "@id".  '+
    'The Location header in the response should be present and populated and not equal the originating entity "@id".', 
    function(done) {
      request
        .put('/v1/api/update')
        .send({"@id":process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907", "RERUM Update Test":new Date(Date.now()).toISOString().replace("Z", "")})
        .set('Content-Type', 'application/json; charset=utf-8')
        .set('Authorization', "Bearer "+process.env.bot_token_dev)
        .expect(200)
        .then(response => {
            expect(response.headers['location']).toBeTruthy()
            expect(response.headers['location']).not.toBe(process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907")
            expect(response.body["@id"]).toBeTruthy()
            expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907")
            done()
        })
        .catch(err => done(err))
    })

    //TODO add a reliable test object here, perhaps '11111'
    it('/patch -- not written.  Expect a 405 for now.', function(done) {
      request
        .get('/v1/api/set')
        .expect(405, done)
        // .patch('/v1/api/patch')
        // .send({"@id":process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907", "test":new Date(Date.now()).toISOString().replace("Z", "")})
        // .set('Content-Type', 'application/json; charset=utf-8')
        // .set('Authorization', "Bearer RERUM")
        // .expect(200)
        // .then(response => {
        //     expect(response.body["@id"]).toBeTruthy()
        //     expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907")
        //     done()
        // })
        // .catch(err => done(err))
    })

    //TODO add a reliable test object here, perhaps '11111'
    it('/set -- not written.  Expect a 405 for now', function(done) {
      //Note unique will probably have a '.'
      const unique = new Date(Date.now()).toISOString().replace("Z", "")
      request
        .get('/v1/api/set')
        .expect(405, done)
        // .patch('/v1/api/set')
        // .send({"@id":process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907", unique:true})
        // .set('Content-Type', 'application/json; charset=utf-8')
        // .set('Authorization', "Bearer RERUM")
        // .expect(200)
        // .then(response => {
        //     expect(response.body["@id"]).toBeTruthy()
        //     expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907")
        //     done()
        // })
        // .catch(err => done(err))
    })

    //TODO add a reliable test object here, perhaps '11111'
    it('/unset -- not written.  Expect a 405 for now.', function(done) {
      request
        .get('/v1/api/unset')
        .expect(405, done)
    })


    it('/delete -- not written.  Expect a 405 for now.', function(done) {
      request
        .get('/v1/api/delete')
        .expect(405, done)
    })

    //TODO query for a reliable object, perhaps '11111'
    it('End to end /v1/api/query. Do a properly formatted /query call by POSTing a JSON query object.  '+
    'It should respond with a 200 and an array, even if there were no matches.  '+
    'We are querying for an object we know exists, so the length of the response should be more than 0.',
    function(done) {
      request
        .post('/v1/api/query')
        .send({"_id" : "6220f0f7f7842d90b2dda907"})
        .set('Content-Type', 'application/json; charset=utf-8')
        .expect(200)
        .then(response => {
            expect(Array.isArray(response.body)).toBe(true)
            expect(response.body.length).toBeTruthy()
            done()
        })
        .catch(err => done(err))
    })
})
