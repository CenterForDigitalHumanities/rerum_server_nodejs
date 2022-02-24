#!/usr/bin/env node
/**
 * Support OPTIONS request, which are essentially CORS enabled heartbeats.  
 * */
exports.optionsRequest = function (req, res) {
    try{
        //Explicitly set these headers and this status.  It's gotta happen.  Make sure it happens.  I'm super serious.
        res.set("Access-Control-Allow-Origin", "*")
        res.set("Access-Control-Allow-Headers", "*")
        res.set("Access-Control-Expose-Headers", "*")
        res.set("Access-Control-Allow-Methods", "*")
        res.sendStatus(200)
    }
    catch(err){
        console.error("Error processing an OPTIONS method request")
        console.log(err)
        res.json({"err":err})
        res.sendStatus(500)
    }
}

/**
 * Since programming languages with HTTP packages don't all support PATCH, we have to detect the workaround.
 * There are 3 states
 *
 *  X-HTTP-Method-Override header is not present means "no", there is no override support, POST is the wrong method so 405
 *  X-HTTP-Method-Override header is present, == PATCH, and method request is POST means "yes", there is valid override support, POST is OK, 200
 *  X-HTTP-Method-Override header is present, !== PATCH or method request is not POST means "invalid", there is invalid override support so 400
 *
 *  REST has a different response for each.
 */
exports.checkPatchOverrideSupport = function(req, res){
    let overrideStatus = "no"
    const overrideHeader = req.getHeader("X-HTTP-Method-Override")
    if(undefined != overrideHeader){
        if(overrideHeader.equals("PATCH")){
            return true
        }
        else{
            res.status(400).send(
                'Detected an invalid attempt to supply the "X-HTTP-Method-Override" header.  '+ 
                'Use the POST method with this header, or use the PATCH method without this header.'
            )
        }
    }
    else{
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    }
}

/**
 * Throughout the routes are certain warning, error, and hard fail scenarios.
 * REST is all about communication.  The response code and the textual body are particular.
 * RERUM is all about being clear.  It will build custom responses sometimes for certain scenarios, will remaining RESTful.
 */
exports.messenger = function(res, err){
    const responseCode = res.statusCode
    const responseMessage = res.statusMessage
    let customResponseBody = {}
    customResponseBody.http_response_code = responseCode
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
            //I think these are so self explanatory that we may not do anything custom with it.
        break
        case 405:
            //I think these are all handled in api-routes.js already.  Not sure we will pass into here for the 405 messages.
        break
        case 500:
            //Really bad, probably not specifically caught.  
            customResponseBody.message = "RERUM experienced a server issue while performing this action.  "
            +"It may not have completed at all, and most likely did not complete successfully."
        case 503:
            //RERUM is down
            customResponseBody.message = "RERUM v1 is down for updates or maintenance at this time.  "  
            +"We aplologize for the inconvenience.  Try again later."
        break


    }
}


