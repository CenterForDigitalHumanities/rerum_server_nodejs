import request from 'supertest'
//Fun fact, if you don't require app, you don't get coverage even though the tests run just fine.
import app from '../../app.js'

//A super fun note.  If you do request(app), the tests will fail due to race conditions.  
//client.connect() in db-controller.js will not finish before some calls to the routes.  So strange.
//request = request(app)
let req = request("http://localhost:3333")

/**
 * All the routes that work for GET requests or paths to HTML pages.
 */

describe('Check to see that all expected routes exists.', () => {

  // it('/ -- Server index.  It should return 200 and an html page.  ', 
  //   function(done) {
  //   req
  //     .get('/')
  //     .expect('X-Powered-By', 'Express', done)
  //     .catch(err => done(err))
  // })

  // it('/v1/ -- App index. ', function(done) {
  //   req
  //     .get("/v1")
  //     .expect(301, done)
  //     .catch(err => done(err))
  // })


  it('/v1/api/ -- RERUM API index.  Responds with a JSON object as a "hello world". ', done => {
    req
      .get("/v1/api")
      .expect("Content-Type", /json/)
      .expect(200)
      .then(response => {
          expect(Object.keys(response.body.endpoints).length).toBe(9)
          done()
      })
      .catch(err => done(err))
  })

  it('/v1/id/{_id} -- RERUM object URL GET by _id pattern.  It should return a 405.', done => {
    req
      .post('/v1/id/11111')
      .expect(405, done)
  })

  it('/v1/since/{_id} -- RERUM /since/:_id pattern.  It should return a 405.', done => {
    req
      .post('/v1/since/11111')
      .expect(405, done)
  })

  it('/v1/history/{_id} -- RERUM /history/:_id pattern.  It should return a 405.', done => {
    req
      .post('/v1/history/11111')
      .expect(405, done)
  })

  it('/maintenance.html -- RERUM API maintenance page.  It should return a 200 and a HTML page. ', done => {
    req
    .get("/maintenance.html")
    .expect("Content-Type", /html/)
    .expect(200, done)
  })

  it('/index.html -- RERUM API registration page.  It should return a 200 and a HTML page. ', done => {
    req
    .get("/index.html")
    .expect("Content-Type", /html/)
    .expect(200, done)
  })

  it('context.json -- It should return a 200 and a JSON file.  ', done => {
    req
    .get("/v1/context.json")
    .expect("Content-Type", /json/)
    .expect(200, done)
  })

  it('/v1/terms.txt -- It should return a 200 and a plain text file. ', done => {
    req
    .get("/v1/terms.txt")
    .expect("Content-Type", /text/)
    .expect(200, done)
  })

  it('/v1/API.html -- RERUM API HTML page.  It should return a 200 and an HTML page. ', done => {
    req
    .get("/v1/API.html")
    .expect("Content-Type", /html/)
    .expect(200, done)
  })

})

describe('Checking each CRUD enpoint exists behind /api.  '+  
  'Each one should return a 405, which lets us know it is registered and being listened for.', 
  () => {

  it('/create', done => {
    req
      .get('/v1/api/create')
      .expect(405, done)
  })
  it('/bulkCreate', done => {
    req
      .get('/v1/api/create')
      .expect(405, done)
  })

  it('/update', done => {
    req
      .get('/v1/api/update')
      .expect(405, done)
  })

  it('/patch', done => {
    req
      .get('/v1/api/patch')
      .expect(405, done)
  })

  it('/set', done => {
    req
      .get('/v1/api/set')
      .expect(405, done)
  })

  it('/unset', done => {
    req
      .get('/v1/api/unset')
      .expect(405, done)
  })

  it('/delete', done => {
    req
      .get('/v1/api/delete/potato')
      .expect(405, done)
  })

  it('/query', done => {
    req
      .get('/v1/api/query')
      .expect(405, done)
  })

  it('/release/{_id}', done => {
    req
      .post('/v1/api/release/zzznznzzzx')
      .expect(405, done)
  })

})

describe('Check for legacy endpoints.', () => {

  // it('accessToken exists', function(done) {
  //   req
  //     .post('/v1/api/accessToken')
  //     .expect(403, done)
  // })

  // it('refreshToken exists', function(done) {
  //   req
  //     .post('/v1/api/refreshToken')
  //     .expect(403, done)
  // })

  it('getByProperties.action redirects to query', done => {
    req
      .get('/v1/api/getByProperties.action')
      .expect(405, done)
  })

  it('create.action exists', done => {
    req
      .get('/v1/api/create.action')
      .expect(405, done)
  })

  it('batch_create.action exists', done => {
    req
      .get('/v1/api/batch_create.action')
      .expect(405, done)
  })

 //update.action exists
  it('update.action exists', done => {
    req
      .get('/v1/api/update.action')
      .expect(405, done)
  })

  //delete.action exists
  it('delete.action exists', done => {
    req
      .get('/v1/api/delete.action/potato')
      .expect(405, done)
  })

  //potatoAction.action does not exist
  it('potatoAction.action does not exist #No404 #broken', done => {
    req
      .get('/v1/api/potatoAction.action')
      .expect(404, done)
  })

})
