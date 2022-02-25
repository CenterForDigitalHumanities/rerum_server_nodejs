const express = require('express')
const app = express()
const jwt = require('express-jwt')
const jwksRsa = require('jwks-rsa')
const jwtAuthz = require('express-jwt-authz')

const checkJwt = jwt({
    // Dynamically provide a signing key based on the kid in the header and the signing keys provided by the JWKS endpoint.
    secret: jwksRsa.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://cubap.auth0.com/.well-known/jwks.json`
    }),
  
    // Validate the audience and the issuer.
    audience: `http://rerum.io/api`,
    issuer: `https://rerum.io/`,
    algorithms: ['RS256']
  })

module.exports = {
    generateNewRefreshToken,
    generateNewAccessToken,
    getJWKS,
    verifyAccess,
    getAccessTokenWithAuth,
    isBot
}
