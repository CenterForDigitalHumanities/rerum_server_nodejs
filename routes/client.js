var express = require('express')
var router = express.Router()

router.get('/register', function(req,res,next){
  //Register means register with the RERUM Server Auth0 client and get a new code for a refresh token.
  //See https://auth0.com/docs/libraries/custom-signup
      var params = new URLSearchParams({
          "audience":process.env.AUDIENCE,
          "scope":"openid name email offline_access",
          //"scope":"name email openid offline_access",
          "response_type":"code",
          //"response_type":"token",
          "client_id":process.env.CLIENT_ID,
          "redirect_uri":process.env.RERUM_BASE,
          "state":"statious123"           
      }).toString()
      res.status(200).send("https://cubap.auth0.com/authorize?" + params)
  })

module.exports = router
