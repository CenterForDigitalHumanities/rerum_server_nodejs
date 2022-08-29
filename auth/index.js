const got = require('got')
// const jwt = require('express-jwt')
// Currently unsed, but we should consider setting scopes moving forward and this will be handy then.
// const jwtAuthz = require('express-jwt-authz')
const { auth } = require('express-oauth2-jwt-bearer')

const dotenv = require('dotenv')
dotenv.config()

//TODO: cannot run auth() until this can pass a botCheck()!
const _tokenError = function (err, req, res, next) {
    let user = JSON.parse(Buffer.from(req.header("authorization").split(" ")[1].split('.')[1], 'base64').toString()) ?? {}
    if (err.status === 401) {
        if(isBot(user)){
            next()
        }
        else{
            err.message = err.statusMessage = `This token does not have permission to perform this action. 
            ${err.message}
            Received token: ${req.header("authorization")}`
            next(err)
        }
    }
}

const _extractUser = (req, res, next) => {
    req.user = JSON.parse(Buffer.from(req.header("authorization").split(" ")[1].split('.')[1], 'base64').toString())
    next()
}

/**
 * Use like: 
 * app.get('/api/private', checkJwt, function(req, res) {
 *   // do authorized things
 * });
 */
const checkJwt = [auth(),_tokenError, _extractUser]
//const checkJwt = [_tokenError, _extractUser]
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
                client_id: process.env.CLIENT_ID,
                CLIENT_SECRET: process.env.CLIENT_SECRET,
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
                client_id: process.env.CLIENT_ID,
                CLIENT_SECRET: process.env.CLIENT_SECRET,
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
 * 
 * @param {Object} obj RERUM database entry
 * @param {Object} User object discerned from token
 * @returns Boolean match between encoded Generator Agent and obj generator
 */
const isGenerator = (obj, userObj) => {
    return userObj[process.env.RERUM_AGENT_CLAIM] === obj.__rerum.generatedBy
}

/**
 * Even expired tokens may be accepted if the Agent is a known bot. This is a 
 * dangerous thing to include, but may be a useful convenience.
 * @param {Object} User object discerned from token
 * @returns Boolean for matching ID.
 */
const isBot = (userObj) => {
    return process.env.BOT_AGENT === userObj[process.env.RERUM_AGENT_CLAIM] ?? "Error"
}

module.exports = {
    checkJwt,
    generateNewAccessToken,
    generateNewRefreshToken,
    verifyAccess,
    isBot,
    isGenerator
}
