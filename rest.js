#!/usr/bin/env node

import utils from './utils.js'

/**
 * This module is used for any REST support functionality.  It is used as middleware and so
 * has access to the http module request and response objects, as well as next()
 * It is in charge of responding to the client.
 *
 * @author thehabes
 */

/**
 * Since programming languages with HTTP packages don't all support PATCH, we have to detect the workaround.
 * There are 3 conditions leading to a boolean outcome.  error messaging is handled upstream.  
 * This is routed to by a res.post() so the request method is ALWAYS POST
 *
 *  X-HTTP-Method-Override header is not present means "no", there is no override support, POST is the wrong method so 405
 *  X-HTTP-Method-Override header is present, !== PATCH means "no", you have done a POST and are not emulating it as a PATCH, so 405
 *  X-HTTP-Method-Override header is present, == PATCH, and method request is POST means "yes", you are emulating a POST as a PATCH, correct method 200
 *
 *  The error handler sits a level up, so do not res.send() here.  Just give back a boolean
 */
const checkPatchOverrideSupport = function (req, res) {
    const override = req.header("X-HTTP-Method-Override")
    return undefined !== override && override === "PATCH"
}

/**
 * Detects multiple MIME types smuggled into a single Content-Type header.
 * Catches both comma-separated types (e.g., "application/json, text/plain")
 * and semicolon-smuggled types (e.g., "application/json; text/plain").
 * Per RFC 7231/2045, semicolons delimit parameters which must be key=value pairs.
 * A segment without '=' after a semicolon is a bare token, not a valid parameter.
 *
 * @param {string} contentType - Lowercased Content-Type header value
 * @returns {boolean} True if multiple MIME types are detected
 */
const hasMultipleContentTypes = (contentType) => {
    if (contentType.includes(",")) return true
    const segments = contentType.split(";")
    return segments.slice(1).some(segment => !segment.trim().includes("="))
}

/**
 * Middleware to verify Content-Type headers for endpoints receiving JSON bodies.
 * Responds with a 415 Invalid Media Type for Content-Type headers that are not for JSON bodies.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const verifyJsonContentType = function (req, res, next) {
    const contentType = (req.get("Content-Type") ?? "").toLowerCase()
    const mimeType = contentType.split(";")[0].trim()
    if (!mimeType) {
        return next(utils.createExpressError({
            statusCode: 415,
            statusMessage: `Missing or empty Content-Type header.`
        }))
    }
    if (hasMultipleContentTypes(contentType)) {
        return next(utils.createExpressError({
            statusCode: 415,
            statusMessage: `Multiple Content-Type values are not allowed. Provide exactly one Content-Type header.`
        }))
    }
    if (mimeType === "application/json" || mimeType === "application/ld+json") return next()
    return next(utils.createExpressError({
        statusCode: 415,
        statusMessage: `Unsupported Content-Type: ${contentType}. This endpoint requires application/json or application/ld+json.`
    }))
}

/**
 * Middleware to verify Content-Type headers for endpoints receiving textual bodies.
 * Responds with a 415 Invalid Media Type for Content-Type headers that are not for textual bodies.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const verifyTextContentType = function (req, res, next) {
    const contentType = (req.get("Content-Type") ?? "").toLowerCase()
    const mimeType = contentType.split(";")[0].trim()
    if (!mimeType) {
        return next(utils.createExpressError({
            statusCode: 415,
            statusMessage: `Missing or empty Content-Type header.`
        }))
    }
    if (hasMultipleContentTypes(contentType)) {
        return next(utils.createExpressError({
            statusCode: 415,
            statusMessage: `Multiple Content-Type values are not allowed. Provide exactly one Content-Type header.`
        }))
    }
    if (mimeType === "text/plain") return next()
    return next(utils.createExpressError({
        statusCode: 415,
        statusMessage: `Unsupported Content-Type: ${contentType}. This endpoint requires text/plain.`
    }))
}

/**
 * Middleware to verify Content-Type headers for endpoints receiving either JSON or textual bodies.
 * Responds with a 415 Invalid Media Type for Content-Type headers that are neither for textual bodies nor JSON bodies.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const verifyEitherContentType = function (req, res, next) {
    const contentType = (req.get("Content-Type") ?? "").toLowerCase()
    const mimeType = contentType.split(";")[0].trim()
    if (!mimeType) {
        return next(utils.createExpressError({
            statusCode: 415,
            statusMessage: `Missing or empty Content-Type header.`
        }))
    }
    if (hasMultipleContentTypes(contentType)) {
        return next(utils.createExpressError({
            statusCode: 415,
            statusMessage: `Multiple Content-Type values are not allowed. Provide exactly one Content-Type header.`
        }))
    }
    if (mimeType === "text/plain" || mimeType === "application/json" || mimeType === "application/ld+json") return next()
    return next(utils.createExpressError({
        statusCode: 415,
        statusMessage: `Unsupported Content-Type: ${contentType}. This endpoint requires application/json, application/ld+json, or text/plain.`
    }))
}

/**
 * Throughout the routes are certain warning, error, and hard fail scenarios.
 * REST is all about communication.  The response code and the textual body are particular.
 * RERUM is all about being clear.  It will build custom responses sometimes for certain scenarios, will remaining RESTful.
 * 
 * You have likely reached this with a next(utils.createExpressError(err)) call.  End here and send the error.
 */
const messenger = function (err, req, res, next) {
    if (res.headersSent) {
        return
    }
    let error = {}
    error.message = err.statusMessage ?? err.message ?? ``
    error.status = err.statusCode ?? err.status ?? 500
    if (error.status === 401) {
        //Special handler for token errors from the oauth module
        //Token errors come through with a message that we want.  That message is in the error's WWW-Authenticate header
        //Other 401s from our app come through with a status message.  They may not have headers.
        if (err.headers?.["WWW-Authenticate"]) {
            error.message += err.headers["WWW-Authenticate"]
        }
    }
    let token = req.header("Authorization")
    if(token && !token.startsWith("Bearer ")){
        error.message +=`
Your token is not in the correct format.  It should be a Bearer token formatted like: "Bearer <token>"`
    }
    switch (error.status) {
        case 400:
            //"Bad Request", most likely because the body and Content-Type are not aligned.  Could be bad JSON.
            error.message += `
The body of your request was invalid. Please make sure it is a valid content-type and that the body matches that type.
If the body is JSON, make sure it is valid JSON.`
            break
        case 401:
            //The requesting agent is known from the request.  That agent does not match __rerum.generatedBy.  Unauthorized.
            if (token) {
                error.message += `
The token provided is Unauthorized.  Please check that it is your token and that it is not expired. 
Token: ${token.slice(0, 15)}... `
            }
            else {
                error.message += `
The request does not contain an "Authorization" header and so is Unauthorized. Please include a token with your requests
like "Authorization: Bearer <token>". Make sure you have registered at ${process.env.RERUM_PREFIX}.`
            }
            break
        case 403:
            //Forbidden to use this.  The provided Bearer does not have the required privileges. 
            if (token) {
                error.message += `
You are Forbidden from performing this action.  Check your privileges.
Token: ${token.slice(0, 15)}...`
            }
            else {
                //If there was no Token, this would be a 401.  If you made it here, you didn't REST.
                error.message += `
You are Forbidden from performing this action. The request does not contain an "Authorization" header.
Make sure you have registered at ${process.env.RERUM_PREFIX}. `
            }
            break
        case 404:
            error.message += `
The requested web page or resource could not be found.`
            break
        case 405:
            // These are all handled in api-routes.js already.
            break
        case 409:
            // These are all handled in db-controller.js already.
            break
        case 415:
            // Unsupported Media Type.  The Content-Type header is not acceptable for this endpoint.
            break
        case 501:
            // Not implemented.  Handled upstream.
            break
        case 503:
            //RERUM is down or readonly.  Handled upstream.
            break
        case 500:
        default:
            //Really bad, probably not specifically caught.  
            error.message += `
RERUM experienced a server issue while performing this action.
It may not have completed at all, and most likely did not complete successfully.`
    }
    console.error(error)
    res.set("Content-Type", "text/plain; charset=utf-8")
    res.status(error.status).send(error.message)
}

export default { checkPatchOverrideSupport, verifyJsonContentType, verifyTextContentType, verifyEitherContentType, messenger }
