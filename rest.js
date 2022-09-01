#!/usr/bin/env node

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
 *  The error handler sits a level up, so do not res.send() or res.render here.  Just give back a boolean
 */
exports.checkPatchOverrideSupport = function(req, res){
    const override = req.header("X-HTTP-Method-Override")
    return undefined !== override && override === "PATCH"
}

/**
 * Throughout the routes are certain warning, error, and hard fail scenarios.
 * REST is all about communication.  The response code and the textual body are particular.
 * RERUM is all about being clear.  It will build custom responses sometimes for certain scenarios, will remaining RESTful.
 * 
 * Note that the res upstream from this has been converted into err.  res will not have what you are looking for, check err instead. 
 */
exports.messenger = function(err, req, res, next){
    if (res.headersSent) {
        return next(err)
    }
    let customResponseBody = {}
    let statusCode = err.statusCode ?? res.statusCode ?? 500
    customResponseBody.http_response_code = statusCode
    let msgIn = ""
    if(err.statusCode){
        if(err.statusCode === 401){
            //Special handler for token errors from the oauth module
            //Token errors come through with a message that we want.  That message is in the error's WWW-Authenticate header
            //Other 401s from our app come through with a status message.  They may not have headers.
            msgIn = err.statusMessage ?? ""
            if(err.headers && err.headers["WWW-Authenticate"]){
                msgIn += err.headers["WWW-Authenticate"]
            }
        }
        else{
            //Other errors will have a status message in one of these places, or no message.
            msgIn = err.statusMessage ?? res.statusMessage ?? ""
        }
    }
    let genericMessage = ""
    let token = req.header("Authorization") ?? ""
    switch (statusCode){
        case 400:
            //"Bad Request", most likely because the body and Content-Type are not aligned.  Could be bad JSON.
            genericMessage = 
            "The body of your request was invalid. Please make sure it is a valid content-type and that the body matches that type.  "
            +"If the body is JSON, make sure it is valid JSON."
        break
        case 401:
            //The requesting agent is known from the request.  That agent does not match __rerum.generatedBy.  Unauthorized.
            if(token){
                genericMessage = 
                `The token provided is Unauthorized.  Please check that it is your token and that it is not expired.  `
                +`Token : { ${token} }`
            }
            else{
                genericMessage = 
                "The request does not contain a token and so is Unauthorized.  Please include a token with your requests "
                +"like 'Authorization: Bearer {token}'. Make sure you have registered at "+process.env.RERUM_PREFIX
            }
            
        break
        case 403:
            //Forbidden to use this.  The provided Bearer does not have the required privileges. 
            if(token){
                genericMessage = 
                `You are Forbidden from performing this action.  Check your privileges.`
                +`Token: ${token}`
            }
            else{
                //If there was no Token, this would be a 401.  If you made it here, you didn't REST.
                genericMessage = `You are Forbidden from performing this action.  Please include a token with your requests `
                +`like 'Authorization: Bearer {token}'. Make sure you have registered at ${process.env.RERUM_PREFIX} `
            }
        case 404:
            genericMessage = 
                "The requested web page or resource could not be found."
        break
        case 405:
            //I think these are all handled in api-routes.js already, and won't route here.  Not sure we would do anything custom here anyway.
        break
        case 500:
            //Really bad, probably not specifically caught.  
            genericMessage = "RERUM experienced a server issue while performing this action.  "
            +"It may not have completed at all, and most likely did not complete successfully."
        case 503:
            //RERUM is down
            genericMessage = "RERUM v1 is down for updates or maintenance at this time.  "  
            +"We aplologize for the inconvenience.  Try again later."
            res.redirect(301, "/maintenance.html")
        break
        default:
            //Unsupported messaging scenario for this helper function.  
            //A customized object for the original error will be sent, if res allows it.
    }
    customResponseBody.message = msgIn ? `${genericMessage}   ---   ${msgIn}` : genericMessage
    res.status(statusCode).send(customResponseBody)
}
