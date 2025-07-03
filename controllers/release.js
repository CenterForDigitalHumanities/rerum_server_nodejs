#!/usr/bin/env node

/**
 * Release controller for RERUM operations
 * Handles release operations and associated tree management
 * @author Claude Sonnet 4, cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation, generateSlugId, establishReleasesTree, healReleasesTree } from './utils.js'

/**
 * Public facing servlet to release an existing RERUM object. This will not
 * perform history tree updates, but rather releases tree updates.
 * (AKA a new node in the history tree is NOT CREATED here.)
 * 
 * The id is on the URL already like, ?_id=.
 * 
 * The user may request the release resource take on a new Slug id.  They can do this
 * with the HTTP Request header 'Slug' or via a url parameter like ?slug=
 */
const release = async function (req, res, next) {
    let agentRequestingRelease = getAgentClaim(req, next)
    let id = req.params["_id"]
    let slug = ""
    let err = {"message":""}
    let treeHealed = false
    if(req.get("Slug")){
        let slug_json = await generateSlugId(req.get("Slug"), next)
        if(slug_json.code){
            next(createExpressError(slug_json))
            return
        }
        else{
            slug = slug_json.slug_id
        }
    }
    if (id){
        let originalObject 
        try {
            originalObject = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        } 
        catch (error) {
            next(createExpressError(error))
            return
        }
        let safe_original = JSON.parse(JSON.stringify(originalObject))
        let previousReleasedID = safe_original.__rerum.releases.previous
        let nextReleases = safe_original.__rerum.releases.next
        
        if (utils.isDeleted(safe_original)) {
            err = Object.assign(err, {
                message: `The object you are trying to release is deleted. ${err.message}`,
                status: 403
            })
        }
        if (utils.isReleased(safe_original)) {
            err = Object.assign(err, {
                message: `The object you are trying to release is already released. ${err.message}`,
                status: 403
            })
        }
        if (!utils.isGenerator(safe_original, agentRequestingRelease)) {
            err = Object.assign(err, {
                message: `You are not the generating agent for this object. You cannot release it. ${err.message}`,
                status: 401
            })
        }
        if (err.status) {
            next(createExpressError(err))
            return
        }
        console.log("RELEASE")
        if (null !== originalObject){
            safe_original["__rerum"].isReleased = new Date(Date.now()).toISOString().replace("Z", "")
            safe_original["__rerum"].releases.replaces = previousReleasedID
            safe_original["__rerum"].slug = slug
            if (previousReleasedID !== "") {
                // A releases tree exists and an ancestral object is being released.
                treeHealed = await healReleasesTree(safe_original)
            } 
            else { 
                // There was no releases previous value.
                if (nextReleases.length > 0) { 
                    // The release tree has been established and a descendant object is now being released.
                    treeHealed = await healReleasesTree(safe_original)
                } 
                else { 
                    // The release tree has not been established
                    treeHealed = await establishReleasesTree(safe_original)
                }
            }
            if (treeHealed) { 
                // If the tree was established/healed
                // perform the update to isReleased of the object being released. Its
                // releases.next[] and releases.previous are already correct.
                let releasedObject = safe_original
                let result
                try {
                    result = await db.replaceOne({ "_id": id }, releasedObject)
                } 
                catch (error) {
                    next(createExpressError(error))
                    return
                }
                if (result.modifiedCount == 0) {
                    //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
                }
                res.set(utils.configureWebAnnoHeadersFor(releasedObject))
                console.log(releasedObject._id+" has been released")
                releasedObject = idNegotiation(releasedObject)
                releasedObject.new_obj_state = JSON.parse(JSON.stringify(releasedObject))
                res.location(releasedObject[_contextid(releasedObject["@context"]) ? "id":"@id"])
                res.json(releasedObject)
                return
            } 
        }
    }
    else{
        //This was a bad request
        err = {
            message: "You must provide the id of an object to release.  Use /release/id-here or release?_id=id-here.",
            status: 400
        }
        next(createExpressError(err))
        return
    }
}

export { release }
