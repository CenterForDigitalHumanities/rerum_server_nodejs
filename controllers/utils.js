#!/usr/bin/env node

/**
 * Utility functions for RERUM controllers
 * @author Claude Sonnet 4, cubap, thehabes
 */
import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'

const ObjectID = newID

/**
 * Check if a @context value contains a known @id-id mapping context
 *
 * @param contextInput An Array of string URIs or a string URI.
 * @return A boolean
 */
function _contextid(contextInput) {
    if(!Array.isArray(contextInput) && typeof contextInput !== "string") return false
    let bool = false
    let contextURI = typeof contextInput === "string" ? contextInput : "unknown"
    const contextCheck = (c) => contextURI.includes(c)
    const knownContexts = [
        "store.rerum.io/v1/context.json",
        "iiif.io/api/presentation/3/context.json",
        "www.w3.org/ns/anno.jsonld",
        "www.w3.org/ns/oa.jsonld"
    ]
    if(Array.isArray(contextInput)) {
        for(const c of contextInput) {
            contextURI = c
            bool = knownContexts.some(contextCheck)
            if(bool) break
        }
    }
    else {
        bool = knownContexts.some(contextCheck)
    }
    return bool
}

/**
 * Modify the JSON of an Express response body by performing _id, id, and @id negotiation.
 * This ensures the JSON has the appropriate _id, id, and/or @id value on the way out to the client.
 * Make sure the first property is @context and the second property is the negotiated @id/id.
 *
 * @param resBody A JSON object representing an Express response body
 * @return JSON with the appropriate modifications around the 'id;, '@id', and '_id' properties.
 */
const idNegotiation = function (resBody) {
    if(!resBody) return
    const _id = resBody._id
    delete resBody._id
    if(!resBody["@context"]) return resBody
    let modifiedResBody = JSON.parse(JSON.stringify(resBody))
    const context = { "@context": resBody["@context"] }
    if(_contextid(resBody["@context"])) {
        delete resBody["@id"]
        delete resBody["@context"]
        modifiedResBody = Object.assign(context, { "id": process.env.RERUM_ID_PREFIX + _id }, resBody)
    }
    return modifiedResBody
}

/**
 * Check if an object with the proposed custom _id already exists.
 * If so, this is a 409 conflict.  It will be detected downstream if we continue one by returning the proposed Slug.
 * We can avoid the 409 conflict downstream and return a newly minted ObjectID.toHextString()
 * We error out right here with next(createExpressError({"code" : 11000}))
 * @param slug_id A proposed _id.  
 * 
 */  
const generateSlugId = async function(slug_id="", next){
    let slug_return = {"slug_id":"", "code":0}
    let slug
    if(slug_id){
        slug_return.slug_id = slug_id
        try {
            slug = await db.findOne({"$or":[{"_id": slug_id}, {"__rerum.slug": slug_id}]})
        } 
        catch (error) {
            //A DB problem, so we could not check.  Assume it's usable and let errors happen downstream.
            console.error(error)
            //slug_return.code = error.code
        }
        if(null !== slug){
            //This already exist, give the mongodb error code.
            slug_return.code = 11000
        }
    } 
    return slug_return
}

// Handle index actions
const index = function (req, res, next) {
    res.json({
        status: "connected",
        message: "Not sure what to do"
    })
}

function createExpressError(err) {
    let error = {}
    if (err.code) {
        switch (err.code) {
            case 11000:
                //Duplicate _id key error, specific to SLUG support.  This is a Conflict.
                error.statusMessage = `The id provided already exists.  Please use a different _id or Slug.`
                error.statusCode = 409
                break
            default:
                error.statusMessage = "There was a mongo error that prevented this request from completing successfully."
                error.statusCode = 500
        }
    }
    error.statusCode = err.statusCode ?? err.status ?? 500
    error.statusMessage = err.statusMessage ?? err.message ?? "Detected Error"
    return error
}

/**
 * An internal helper for removing a document from the database using a known _id or __rerums.slug.
 * This is not exposed over the http request and response.
 * Use it internally where necessary.  Ex. end to end Slug test
 */
const remove = async function(id) {
    try {
        const result = await db.deleteOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        if (result.deletedCount !== 1) {
            throw Error("Could not remove object")
        }
        return true
    }
    catch (error) {
        error.message = "Could not remove object"
        throw error
    }
}

/**
 * An internal helper for getting the agent from req.user
 * If you do not find an agent, the API does not know this requestor.
 * This means attribution is not possible, regardless of the state of the token.
 * The app is forbidden until registered with RERUM.  Access tokens are encoded with the agent.
 */
function getAgentClaim(req, next) {
    const claimKeys = [process.env.RERUM_AGENT_CLAIM, "http://devstore.rerum.io/v1/agent", "http://store.rerum.io/agent"]
    let agent = ""
    for (const claimKey of claimKeys) {
        agent = req.user[claimKey]
        if (agent) {
            return agent
        }
    }
    let err = {
        "message": "Could not get agent from req.user.  Have you registered with RERUM?",
        "status": 403
    }
    next(createExpressError(err))  
}

function parseDocumentID(atID){
    if(typeof atID !== 'string') {
        throw new Error("Unable to parse this type.")
    }
    if(!/^https?/.test(atID)){
        throw new Error(`Designed for parsing URL strings. Please check: ${atID}`)
    }
    return atID.split('/').pop()
}

/**
 * Internal helper method to update the history.next property of an object.  This will occur because updateObject will create a new object from a given object, and that
 * given object will have a new next value of the new object.  Watch out for missing __rerum or malformed __rerum.history
 * 
 * @param idForUpdate the @id of the object whose history.next needs to be updated
 * @param newNextID the @id of the newly created object to be placed in the history.next array.
 * @return Boolean altered true on success, false on fail
 */
async function alterHistoryNext(objToUpdate, newNextID) {
    //We can keep this real short if we trust the objects sent into here.  I think these are private helper functions, and so we can.
    if(objToUpdate.__rerum.history.next.indexOf(newNextID) === -1){
        objToUpdate.__rerum.history.next.push(newNextID)
        let result = await db.replaceOne({ "_id": objToUpdate["_id"] }, objToUpdate)
        return result.modifiedCount > 0
    }
    return true
}

/**
 * Internal private method to loads all derivative versions from the `root` object. It should always receive a reliable object, not one from the user.
 * Used to resolve the history tree for storing into memory.
 * @param  obj A JSONObject to find all versions of.  If it is root, make sure to prepend it to the result.  If it isn't root, query for root from the ID
 * found in prime using that result as a reliable root object. 
 * @return All versions from the store of the object in the request
 * @throws Exception when a JSONObject with no '__rerum' property is provided.
 */
async function getAllVersions(obj) {
    let ls_versions
    let primeID = obj?.__rerum.history.prime
    let rootObj
    if (primeID === "root") {
        //The obj passed in is root.  So it is the rootObj we need.
        rootObj = JSON.parse(JSON.stringify(obj))
    } else {
        //The obj passed in knows the ID of root, grab it from Mongo
        //Use _id for indexed query performance instead of @id
        const primeHexId = parseDocumentID(primeID)
        rootObj = await db.findOne({"$or":[{"_id": primeHexId}, {"__rerum.slug": primeHexId}]})
    }
    //All the children of this object will have its @id in __rerum.history.prime
    ls_versions = await db.find({ "__rerum.history.prime": rootObj['@id'] }).toArray()
    //The root object is a version, prepend it in
    ls_versions.unshift(rootObj)
    return ls_versions
}

/**
 * Internal method to filter ancestors upstream from `key object` until `root`. It should always receive a reliable object, not one from the user.
 * This list WILL NOT contains the keyObj.
 * 
 *  "Get requests can't have body"
 *  In fact in the standard they can (at least nothing says they can't). But lot of servers and firewall implementation suppose they can't 
 *  and drop them so using body in get request is a very bad idea.
 * 
 * @param ls_versions all the versions of the key object on all branches
 * @param keyObj The object from which to start looking for ancestors.  It is not included in the return. 
 * @param discoveredAncestors The array storing the ancestor objects discovered by the recursion.
 * @return All the objects that were deemed ancestors in a JSONArray
 */
function getAllAncestors(ls_versions, keyObj, discoveredAncestors) {
    let previousID = keyObj.__rerum.history.previous //The first previous to look for
    for (let v of ls_versions) {
        if (keyObj.__rerum.history.prime === "root") {
            //Check if we found root when we got the last object out of the list.  If so, we are done.  If keyObj was root, it will be detected here.  Break out. 
            break
        }
        else if (v["@id"] === previousID) {
            //If this object's @id is equal to the previous from the last object we found, its the one we want.  Look to its previous to keep building the ancestors Array.   
            previousID = v.__rerum.history.previous
            if (previousID === "" && v.__rerum.history.prime !== "root") {
                //previous is blank and this object is not the root.  This is gunna trip it up.  
                //@cubap Yikes this is a problem.  This branch on the tree is broken...what should we tell the user?  How should we handle?
                break
            }
            else {
                discoveredAncestors.push(v)
                //Recurse with what you have discovered so far and this object as the new keyObj
                getAllAncestors(ls_versions, v, discoveredAncestors)
                break
            }
        }
    }
    return discoveredAncestors
}

/**
 * Internal method to find all downstream versions of an object.  It should always receive a reliable object, not one from the user.
 * If this object is the last, the return will be an empty JSONArray.  The keyObj WILL NOT be a part of the array.  
 * @param  ls_versions All the given versions, including root, of a provided object.
 * @param  keyObj The provided object
 * @param  discoveredDescendants The array storing the descendants objects discovered by the recursion.
 * @return All the objects that were deemed descendants in a JSONArray
 */
function getAllDescendants(ls_versions, keyObj, discoveredDescendants) {
    let nextIDarr = []
    if (keyObj.__rerum.history.next.length === 0) {
        //essentially, do nothing.  This branch is done.
    }
    else {
        //The provided object has nexts, get them to add them to known descendants then check their descendants.
        nextIDarr = keyObj.__rerum.history.next
    }
    for (let nextID of nextIDarr) {
        for (let v of ls_versions) {
            if (v["@id"] === nextID) { //If it is equal, add it to the known descendants
                //Recurse with what you have discovered so far and this object as the new keyObj
                discoveredDescendants.push(v)
                getAllDescendants(ls_versions, v, discoveredDescendants)
                break
            }
        }
    }
    return discoveredDescendants
}

/**
 * Internal helper method to establish the releases tree from a given object
 * that is being released.
 * This can probably be collapsed into healReleasesTree. It contains no checks,
 * it is brute force update ancestors and descendants.
 * It is significantly cleaner and slightly faster than healReleaseTree() which
 * is why I think we should keep them separate.
 * 
 * This method only receives reliable objects from mongo.
 * 
 * @param obj the RERUM object being released
 * @return Boolean sucess or some kind of Exception
 */
async function establishReleasesTree(releasing) {
    let success = true
    const all = await getAllVersions(releasing)
    .catch(error => {
        console.error(error)
        return []
    })
    const descendants = getAllDescendants(all, releasing, [])
    const ancestors = getAllAncestors(all, releasing, [])
    for(const d of descendants){
        let safe_descendant = JSON.parse(JSON.stringify(d))
        let d_id = safe_descendant._id
        safe_descendant.__rerum.releases.previous = releasing["@id"]
        let result
        try {
            result = await db.replaceOne({ "_id": d_id }, safe_descendant)
        } 
        catch (error) {
            console.error(error)
            return false
        }
        if (result.modifiedCount == 0) {
            //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
            //console.log("nothing modified...")
            //success = false
        }  
    }
    for(const a of ancestors){
        let safe_ancestor = JSON.parse(JSON.stringify(a))
        let a_id = safe_ancestor._id
        if(safe_ancestor.__rerum.releases.next.indexOf(releasing["@id"]) === -1){
            safe_ancestor.__rerum.releases.next.push(releasing["@id"])    
        }
        let result
        try {
            result = await db.replaceOne({ "_id": a_id }, safe_ancestor)
        } 
        catch (error) {
            console.error(error)
            return false
        }
        if (result.modifiedCount == 0) {
            //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
            //console.log("nothing modified...")
            //success = false
        }  
    }
    return success
}

/**
 * Internal helper method to update the releases tree from a given object that
 * is being released. See code in method for further documentation.
 * https://www.geeksforgeeks.org/find-whether-an-array-is-subset-of-another-array-set-1/
 * 
 * This method only receives reliable objects from mongo.
 * 
 * @param obj the RERUM object being released
 * @return Boolean success or some kind of Exception
 */
async function healReleasesTree(releasing) {
    let success = true
    const all = await getAllVersions(releasing)
    .catch(error => {
        console.error(error)
        return []
    })
    const descendants = getAllDescendants(all, releasing, [])
    const ancestors = getAllAncestors(all, releasing, [])
    for(const d of descendants){
        let safe_descendant = JSON.parse(JSON.stringify(d))
        let d_id = safe_descendant._id
        if(d.__rerum.releases.previous === releasing.__rerum.releases.previous){
            // If the descendant's previous matches the node I am releasing's
            // releases.previous, swap the descendant releses.previous with node I am releasing's @id.
            safe_descendant.__rerum.releases.previous = releasing["@id"]
            if(d.__rerum.isReleased !== ""){
                // If this descendant is released, it replaces the node being released
                if(d.__rerum.releases.previous === releasing["@id"]){
                    safe_descendant.__rerum.releases.replaces = releasing["@id"]
                }
            }
            let result
            try {
                result = await db.replaceOne({ "_id": d_id }, safe_descendant)
            } 
            catch (error) {
                console.error(error)
                return false
            }
            if (result.modifiedCount == 0) {
                //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
                //success = false
            }
        }    
    }
    let origNextArray = releasing.__rerum.releases.next
    for (const a of ancestors){
        let safe_ancestor = JSON.parse(JSON.stringify(a))
        let a_id = safe_ancestor._id
        let ancestorNextArray = safe_ancestor.__rerum.releases.next
        if (ancestorNextArray.length == 0) {
            // The releases.next on the node I am releasing is empty. This means only other
            // ancestors with empty releases.next[] are between me and the next ancenstral released node
            // Add the id of the node I am releasing into the ancestor's releases.next array.
            if(ancestorNextArray.indexOf(releasing["@id"]) === -1){
                ancestorNextArray.push(releasing["@id"])
            }
        }
        else{
            // The releases.next on the node I am releasing has 1 - infinity entries. I need
            // to check if any of the entries of that array exist in the releases.next of my
            // ancestors and remove them before
            // adding the @id of the released node into the acenstral releases.next array.  
            for(const i of origNextArray){
                for(const j of ancestorNextArray){
                    // For each id in the ancestor's releases.next array
                    if (i === j) {
                        // If the id is in the next array of the object I am releasing and in the
                        // releases.next array of the ancestor
                        const index = ancestorNextArray.indexOf(j)
                        if (index > -1) {
                            // remove that id.
                          ancestorNextArray = ancestorNextArray.splice(index, 1)
                        }
                    }
                }
            }
            // Whether or not the ancestral node replaces the node I am releasing or not
            // happens in releaseObject() when I make the node I am releasing isReleased
            // because I can use the releases.previous there.
            // Once I have checked against all id's in the ancestor node releases.next[] and removed the ones I needed to
            // Add the id of the node I am releasing into the ancestor's releases.next array.
            if(ancestorNextArray.indexOf(releasing["@id"]) === -1){
                ancestorNextArray.push(releasing["@id"])
            }
        }
        safe_ancestor.__rerum.releases.next = ancestorNextArray
        let result
        try {
            result = await db.replaceOne({ "_id": a_id }, safe_ancestor)
        } 
        catch (error) {
            console.error(error)
            return false
        }
        if (result.modifiedCount == 0) {
            //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
            //success = false
        }
    
    }
    return success
}

export {
    _contextid,
    idNegotiation,
    generateSlugId,
    index,
    ObjectID,
    createExpressError,
    remove,
    getAgentClaim,
    parseDocumentID,
    alterHistoryNext,
    getAllVersions,
    getAllAncestors,
    getAllDescendants,
    establishReleasesTree,
    healReleasesTree
}
