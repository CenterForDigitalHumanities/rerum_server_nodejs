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
