const got = require('got')
const jwt = require('express-jwt')
// Currently unsed, but we should consider setting scopes moving forward and this will be handy then.
// const jwtAuthz = require('express-jwt-authz')
const { auth } = require('express-oauth2-jwt-bearer');

/**
 * Use like: 
 * app.get('/api/private', checkJwt, function(req, res) {
 *   // do authorized things
 * });
 */
const checkJwt = auth({
    audience: 'http://rerum.io/api',
    issuerBaseURL: `https://cubap.auth0.com/`,
})

/**
 * Public API proxy to generate new access tokens through Auth0
 * with a refresh token when original access has expired.
 * @param {ExpressRequest} req from registered server application.
 * @param {ExpressResponse} res to return the new token.
 */
const generateNewAccessToken = async (req, res) => {
    console.log("Generating a proxy access token.")

    const tokenObj = await got.post('https://cubap/oauth/token',
        {
            form: {
                grant_type: 'refresh_token',
                client_id: process.env.client_id,
                client_secret: process.env.client_secret,
                refresh_token: req.body.refresh_token
            }
        }).json()
    res.send(tokenObj)
}

/**
 * Used by RERUM to renew the refresh token upon user request.
 * @param {ExpressRequest} req from registered server application.
 * @param {ExpressResponse} res to return the new token.
 */
const generateNewRefreshToken = async (req, res) => {
    console.log("Generating a new refresh token.")

    const tokenObj = await got.post('https://cubap/oauth/token',
        {
            form: {
                grant_type: 'authorization_code',
                client_id: process.env.client_id,
                client_secret: process.env.client_secret,
                refresh_token: req.body.refresh_token,
                code: req.body.authorization_code
            }
        }).json()
    res.send(tokenObj)
}

/**
 * Upon requesting an action, confirm the request has a valid token.
 * @param {(Base64)String} secret access_token from `Bearer` header in request
 * @returns decoded payload of JWT if successful
 * @throws Error if token, signature, or date is invalid
 */
const verifyAccess = (secret) => {
    return jwt({
        secret,
        audience: `http://rerum.io/api`,
        issuer: `https://rerum.io/`,
        algorithms: ['RS256']
    })
}

/**
 * Even expired tokens may be accepted if the Agent is a known bot. This is a 
 * dangerous thing to include, but may be a useful convenience.
 * @param {URI} generatorId Agent ID of a known Auth0 bot to automatically approve.
 * @returns Boolean for matching ID.
 */
const isBot = (generatorId) => process.env.bot_agent === generatorId

module.exports = {
    checkJwt,
    generateNewAccessToken,
    generateNewRefreshToken,
    verifyAccess,
    isBot
}
