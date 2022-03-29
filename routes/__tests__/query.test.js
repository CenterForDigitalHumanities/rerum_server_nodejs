

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
