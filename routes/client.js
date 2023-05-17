var express = require('express')
var router = express.Router()
const auth = require('../auth')

router.get('/register', function(req,res,next){
  //Register means register with the RERUM Server Auth0 client and get a new code for a refresh token.
  //See https://auth0.com/docs/libraries/custom-signup
      var params = new URLSearchParams({
          "audience":process.env.AUDIENCE,
          "scope":"offline_access",
          "response_type":"code",
          "client_id":process.env.CLIENT_ID,
          "redirect_uri":process.env.RERUM_PREFIX,
          "state":"register"           
      }).toString()
      res.status(200).send("https://cubap.auth0.com/authorize?" + params)
  })

  router.post('/request-new-access-token',auth.generateNewAccessToken)
  router.post('/request-new-refresh-token',auth.generateNewRefreshToken)
  router.get('/verify',auth.checkJwt)

module.exports = router
