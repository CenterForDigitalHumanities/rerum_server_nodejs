let request = require("supertest")
//const app = require("../../app")

//All on one host.  If not, do not use this and use request(app) syntax instead.
request = request("http://localhost:3333")

/**
 * All the routes that work for GET requests or paths to HTML pages.
 */ 

describe('Checking that each CRUD endpoint behind /api/ functions with proper input.', function() {

  it('/create', function(done) {
    request
      .post('/v1/api/create')
      .send({"RERUM Create Test" : new Date(Date.now()).toISOString().replace("Z", "")})
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Authorization', "Bearer RERUM")
      .expect(201)
      .then(response => {
          expect(response.body["@id"]).toBeTruthy()
          done()
      })
      .catch(err => done(err))
  })

  //TODO add a reliable test object here, perhaps '11111'
  it('/update', function(done) {
    request
      .put('/v1/api/update')
      .send({"@id":process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907", "RERUM Update Test":new Date(Date.now()).toISOString().replace("Z", "")})
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Authorization', "Bearer RERUM")
      .expect(200)
      .then(response => {
          expect(response.body["@id"]).toBeTruthy()
          expect(response.body["@id"]).not.toBe(process.env.RERUM_ID_PREFIX+"6220f0f7f7842d90b2dda907")
          done()
      })
      .catch(err => done(err))
  })

  //TODO add a reliable test object here, perhaps '11111'
  it('/patch -- not written yet should 405', function(done) {
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
  it('/set -- not written yet should 405', function(done) {
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
  it('/unset -- not written yet should 405', function(done) {
    request
      .get('/v1/api/unset')
      .expect(405, done)
  })


  it('/delete -- not written yet should 405', function(done) {
    request
      .get('/v1/api/delete')
      .expect(405, done)
  })

  //TODO query for a reliable object, perhaps '11111'
  it('/query', function(done) {
    request
      .post('/v1/api/query')
      .send({"_id" : "6220f0f7f7842d90b2dda907"})
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Authorization', "Bearer RERUM")
      .expect(200)
      .then(response => {
          expect(Array.isArray(response.body)).toBe(true)
          done()
      })
      .catch(err => done(err))
  })

})