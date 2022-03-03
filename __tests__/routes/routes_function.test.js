/**
 * Check that the endpoints are functioning as expected.
 * Perform each of them under expected functional conditions.
 */ 
// describe('Checking each CRUD enpoint exists behind /api', function() {
  
//   it('/create', function(done) {
//     request
//       .post('/v1/api/create')
//       .send({"RERUM Test":new Date(Date.now()).toISOString().replace("Z", "")})
//       .expect(201)
//       .then(response => {
//         expect(response.body["@id"]).toBeTruthy()
//         done()
//       })
//       .catch(err => done(err))
//   })

//   it('/update', function(done) {
//     request
//       .get('/v1/api/update')
//       .expect(405, done)
//   })

//   it('/patch', function(done) {
//     request
//       .get('/v1/api/patch')
//       .expect(405, done)
//   })

//   it('/set', function(done) {
//     request
//       .get('/v1/api/set')
//       .expect(405, done)
//   })

//   it('/unset', function(done) {
//     request
//       .get('/v1/api/unset')
//       .expect(405, done)
//   })

//   it('/delete', function(done) {
//     request
//       .get('/v1/api/delete')
//       .expect(405, done)
//   })

//   it('/query', function(done) {
//     request
//       .get('/v1/api/query')
//       .expect(405, done)
//   })

// })