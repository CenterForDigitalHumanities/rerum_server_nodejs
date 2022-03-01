#!/usr/bin/env node

/**
 * This module is general utilities.  It should not respond to clients or manipulate the 
 * http request/response.  
 * 
 * @author thehabes 
 */

/**
 * Add the __rerum properties object to a given JSONObject.If __rerum already exists, it will be overwritten because this method is only called on new objects. Properties for consideration are:
APIversion        —1.0.0
history.prime     —if it has an @id, import from that, else "root"
history.next      —always [] 
history.previous  —if it has an @id, @id
releases.previous —if it has an @id, import from that, else ""
releases.next     —always [] 
releases.replaces —always ""
generatedBy       —set to the @id of the public agent of the API Key.
createdAt         —DateTime of right now.
isOverwritten     —always ""
isReleased        —always ""
 * 
 * @param received A potentially optionless JSONObject from the Mongo Database (not the user).  This prevents tainted __rerum's
 * @param update A trigger for special handling from update actions
 * @return configuredObject The same object that was recieved but with the proper __rerum options.  This object is intended to be saved as a new object (@see versioning)
 */
exports.configureRerumOptions = function(generator, received, update, extUpdate){
    let configuredObject = JSON.parse(JSON.stringify(received))
    let received_options = received["__rerum"] ? received["__rerum"] : {}
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
        history_previous = received["@id"] ? received["@id"] : received["id"] ? received["id"] : ""
    }
    else{
        //We are either updating an existing RERUM object or creating a new one.
        if(received_options.hasOwnProperty("history")){
            history = received_options.history
            if(update){
                //This means we are configuring from the update action and we have passed in a clone of the originating object (with its @id) that contained a __rerum.history
                if(history.prime === "root"){
                    //Hitting this case means we are updating from the prime object, so we can't pass "root" on as the prime value
                    history_prime = received["@id"]
                }
                else{
                    //Hitting this means we are updating an object that already knows its prime, so we can pass on the prime value
                    history_prime = history.prime
                }
                //Either way, we know the previous value shold be the @id of the object received here. 
                history_previous = received["@id"]
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
    rerumOptions["@context"] = process.env.RERUM_CONTEXT
    rerumOptions.alpha = true
    rerumOptions.APIversion = process.env.RERUM_API_VERSION
    //It is important for the cache workflow that these be properly formatted.  
    let creationDateTime = new Date(Date.now()).toISOString().replace("Z", "")
    rerumOptions.createdAt = creationDateTime
    rerumOptions.isOverwritten = ""
    rerumOptions.isReleased = ""
    rerumOptions.history = history
    rerumOptions.releases = releases
    rerumOptions.generatedBy = generator
    configuredObject["__rerum"] = rerumOptions
    return configuredObject //The mongo save/update has not been called yet.  The object returned here will go into mongo.save or mongo.update
}

/**
 * Check this object for deleted status.  deleted objects in RERUM look like {"@id":"{some-id}", __deleted:{object properties}}
 */ 
exports.checkIfDeleted = function(obj){
    return obj.hasOwnProperty("__deleted")
}

/**
 * Check this object for released status.  Released objects in RERUM look like {"@id":"{some-id}", __rerum:{"isReleased" : "ISO-DATE-TIME"}}
 */ 
exports.checkIfReleased = function(obj){
    return obj.hasOwnProperty("__rerum") && obj["__rerum"].hasOwnProperty("isReleased") && obj["__rerum"]["isReleased"] !== ""
}