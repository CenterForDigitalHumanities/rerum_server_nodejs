import express from 'express'
const router = express.Router()
import auth from '../auth/index.js'
import { getAgentClaim } from '../controllers/utils.js'

router.get('/register', (req, res, next) => {
  //Register means register with the RERUM Server Auth0 client and get a new code for a refresh token.
  //See https://auth0.com/docs/libraries/custom-signup
      const params = new URLSearchParams({
          "audience":process.env.AUDIENCE,
          "scope":"offline_access",
          "response_type":"code",
          "client_id":process.env.CLIENT_ID,
          "redirect_uri":process.env.RERUM_PREFIX,
          "state":"register"           
      }).toString()
      res.status(200).send(`https://cubap.auth0.com/authorize?${params}`)
  })

router.post('/request-new-access-token',auth.generateNewAccessToken)
router.post('/request-new-refresh-token',auth.generateNewRefreshToken)

// Verifies good tokens are from RERUM.  Fails with 401 on tokens from other platforms, or bad tokens in genreal.
router.get('/verify', auth.checkJwt, (req, res, next) => {
  const generatorAgent = getAgentClaim(req, next)
  res.set("Content-Type", "text/plain")
  res.status(200)
  res.send("The token was verified by Auth0")
})

export default router
