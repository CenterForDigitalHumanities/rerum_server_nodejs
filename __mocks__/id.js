/**
 * @author bhaberbe
 */
import nock from 'nock'

//Set up the handler for a mock /v1/id/{_id} request that is successful
nock("http://localhost:3333")
.get('/v1/id/abcde')
.reply(200, 
  {
    "_id":"abcde",
    "__rerum":{},
    "@id":`${process.env.RERUM_ID_PREFIX}abcde`
  },
  {
    "Location" : `${process.env.RERUM_ID_PREFIX}abcde`
  }
)

//Set up the handler for a mock /v1/id/{_id} request that is 404
nock("http://localhost:3333")
.get('/v1/id/fghij')
.reply(404, "Not Found")

//Set up the handler for a mock /v1/id/{_id} request without the _id parameter
nock("http://localhost:3333")
.get('/v1/id/')
.reply(400, "Bad Request.  Needs id.")
//.reply(404, "Not Found")

//Set up the handler for a mock /v1/id/{_id} request that encounters a server error
nock("http://localhost:3333")
.get('/v1/id/server_error')
.reply(500, "The server encountered an error")

//Set up the handler for a mock /v1/id/{_id} request that is accidentally called under the v1/api pattern
nock("http://localhost:3333")
.get('/v1/api/id/12345')
.reply(404, "Not Found")

//Set up the handler for a mock /v1/id/{_id} request that forgot the /v1/ pattern
nock("http://localhost:3333")
.get('/id/12345')
.reply(404, "Not Found")
