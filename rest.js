
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
 * If the user supplies the header
 * @param http_request the request that was made so we can check its headers. 
 */
exports.checkPatchOverrideSupport = function(req, resp){
    let overrideStatus = "no"
    const overrideHeader = req.getHeader("X-HTTP-Method-Override");
    if(undefined != overrideHeader){
        if(overrideHeader.equals("PATCH")){
            overrideStatus = "yes"
        }
        else{
            overrideStatus = "improper"
        }
    }
    return overrideStatus;
}
