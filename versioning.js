import config from './config/index.js'

/**
 * Configure and attach the `__rerum` metadata object to a given JSON object.
 *
 * This function prepares a standardized metadata structure required by RERUM
 * for versioning, history tracking, and attribution. If an existing `__rerum`
 * object is present, it will be ignored or overwritten depending on the context
 * to prevent the use of untrusted or user-provided metadata.
 *
 * The metadata includes:
 * - API version and context
 * - Creation timestamp
 * - History tracking (prime, previous, next)
 * - Release tracking (previous, next, replaces)
 * - Generator (agent responsible for creation/update)
 * - Flags for overwrite and release status
 *
 * Special handling:
 * - `update` indicates the object is being updated from an existing RERUM object
 * - `extUpdate` indicates importing an external object into RERUM as a new root object
 *
 * @param {string} generator - The agent identifier (URI) responsible for creating or modifying the object.
 * @param {object} received - The original object (typically from MongoDB) to be configured.
 * @param {boolean} update - Flag indicating whether this operation is an update to an existing RERUM object.
 * @param {boolean} extUpdate - Flag indicating whether this is an external import treated as a new root object.
 * @returns {object} The cloned object with a fully configured `__rerum` metadata object attached.
 */
const configureRerumOptions = function(generator, received, update, extUpdate){
    let configuredObject = JSON.parse(JSON.stringify(received))
    let received_options = received.__rerum ? JSON.parse(JSON.stringify(received.__rerum)) : {}
    let history = {}
    let releases = {}
    let rerumOptions = {}
    let history_prime = ""
    let history_previous = ""
    let releases_previous = ""
    if(extUpdate){
        //We are "importing" an external object as a new object in RERUM (via an update).  It can knows its previous external self, but is a root for its existence in RERUM.
        received_options = {}
        history_prime = "root"
        history_previous = received["@id"] ?? received.id ?? ""
    }
    else{
        //We are either updating an existing RERUM object or creating a new one.
        if(received_options.hasOwnProperty("history")){
            history = received_options.history
            if(update){
                //This means we are configuring from the update action and we have passed in a clone of the originating object (with its @id) that contained a __rerum.history
                if(history.prime === "root"){
                    //Hitting this case means we are updating from the prime object, so we can't pass "root" on as the prime value
                    history_prime = received["@id"] ?? received.id ?? ""
                }
                else{
                    //Hitting this means we are updating an object that already knows its prime, so we can pass on the prime value
                    history_prime = history.prime
                }
                //Either way, we know the previous value shold be the @id of the object received here. 
                history_previous = received["@id"] ?? received.id ?? ""
            }
            else{
                //Hitting this means we are saving a new object and found that __rerum.history existed.  We don't trust it, act like it doesn't have it.
                history_prime = "root"
                history_previous = ""
            }
        }
        else{
            //Hitting this means we are are saving an object that did not have __rerum history.  This is normal   
            history_prime = "root"
            history_previous = ""
        }
        if(received_options.hasOwnProperty("releases")){
            releases = received_options.releases
            releases_previous = releases.previous
        }
        else{
            releases_previous = ""         
        }
    } 
    releases.next = []
    releases.previous = releases_previous
    releases.replaces = ""
    history.next = []
    history.previous = history_previous
    history.prime = history_prime
    rerumOptions["@context"] = config.RERUM_CONTEXT
    rerumOptions.alpha = true
    rerumOptions.APIversion = config.RERUM_API_VERSION
    //It is important for the cache workflow that these be properly formatted.  
    let creationDateTime = new Date(Date.now()).toISOString().replace("Z", "")
    rerumOptions.createdAt = creationDateTime
    rerumOptions.isOverwritten = ""
    rerumOptions.isReleased = ""
    rerumOptions.history = history
    rerumOptions.releases = releases
    rerumOptions.generatedBy = generator
    configuredObject.__rerum = rerumOptions
    return configuredObject //The mongo save/update has not been called yet.  The object returned here will go into mongo.save or mongo.update
}

export {
    configureRerumOptions
}
