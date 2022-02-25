#!/usr/bin/env node
/**
 * Support OPTIONS request, which are essentially CORS enabled heartbeats.  
 * */
exports.optionsRequest = function (req, res) {
    //Explicitly set these headers and this status.  It's gotta happen.  Make sure it happens.  I'm super serious.
    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Headers", "*")
    res.set("Access-Control-Expose-Headers", "*")
    res.set("Access-Control-Allow-Methods", "*")
    res.sendStatus(200)
}

/**
 * Since programming languages with HTTP packages don't all support PATCH, we have to detect the workaround.
 * There are 3 conditions leading to a boolean outcome.  error messaging is handled upstream.  
 * This is routed to by a res.post() so the request method is ALWAYS POST
 *
 *  X-HTTP-Method-Override header is not present means "no", there is no override support, POST is the wrong method so 405
 *  X-HTTP-Method-Override header is present, !== PATCH means "no", you have done a POST and are not emulating it is as a PATCH, so 405
 *  X-HTTP-Method-Override header is present, == PATCH, and method request is POST means "yes", you are emulating a POST as a PATCH, correct method 200
 *
 *  The error handler sits a level up, so do not res.send() or res.render here.  Just give back a boolean
 */
exports.checkPatchOverrideSupport = function(req, res){
    const overrideHeader = req.getHeader("X-HTTP-Method-Override")
    if(undefined != overrideHeader){
        if(overrideHeader.equals("PATCH")){
            return true
        }
    }
    return false
}

/**
 * Throughout the routes are certain warning, error, and hard fail scenarios.
 * REST is all about communication.  The response code and the textual body are particular.
 * RERUM is all about being clear.  It will build custom responses sometimes for certain scenarios, will remaining RESTful.
 */
exports.messenger = function(err, req, res, next){
    if (res.headersSent) {
        console.log("Middleware cannot control this error.  Headers are sent.")
        return next(err)
    }
    const responseCode = err.statusCode
    const responseMessage = err.statusMessage
    console.log("I am in messenger with code '"+responseCode+"' and message '"+responseMessage+"'")
    let customResponseBody = {}
    customResponseBody.http_response_code =  responseCode
    customResponseBody.message = responseMessage
    switch (responseCode){
        case 400:
            //"Bad Request", most likely because the body and Content-Type are not aligned.  Could be bad JSON.
            customResponseBody.message = 
            "The body of your request was invalid. Please make sure it is a valid content-type and that the body matches that type.  "
            +"If the body is JSON, make sure it is valid JSON."
        break
        case 401:
            //The requesting agent is known from the request.  That agent does not match __rerum.generatedBy.  Unauthorized.
            customResponseBody.message = 
            "This application is not the generator for the object you are trying to alter.  Fork the object via an update to make changes."
        break
        case 403:
            //Forbidden to use this.  There may not be an Authorization header, or that header is invalid, or the Bearer is not known to RERUM.
            if(res.getHeader("Authorization")){
                customResponseBody.message = 
                "RERUM could not authorize you to perform this action.  The 'Bearer' is not of RERUM.  "
                +"Make sure you have registered at "+process.env.RERUM_PREFIX
            }
            else{
                customResponseBody.message = 
                "Improper or missing Authorization header provided on request.  Required header must be 'Authorization: Bearer {token}'.  "
                +"Make sure you have registered at "+process.env.RERUM_PREFIX
            }  
        break
        case 404:
            customResponseBody.message = 
                "The requested web page or resource could not be found."
        break
        case 405:
            //I think these are all handled in api-routes.js already, and won't route here.  Not sure we would do anything custom here anyway.
        break
        case 500:
            //Really bad, probably not specifically caught.  
            customResponseBody.message = "RERUM experienced a server issue while performing this action.  "
            +"It may not have completed at all, and most likely did not complete successfully."
        case 503:
            //RERUM is down
            customResponseBody.message = "RERUM v1 is down for updates or maintenance at this time.  "  
            +"We aplologize for the inconvenience.  Try again later."
            res.redirect(301, "/maintenance.html")
        break
        default:
            //Unsupported messaging scenario for this helper function.  
            //A customized object for the original error will be sent, if res allows it.
    }
    console.log("Messenger to send custom body")
    console.log(customResponseBody)
    res.status(responseCode).send(customResponseBody)
}
