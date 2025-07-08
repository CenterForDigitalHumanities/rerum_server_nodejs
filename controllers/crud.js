#!/usr/bin/env node

/**
 * Basic CRUD operations for RERUM v1
 * @author Claude Sonnet 4, cubap, thehabes
 */
import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, idNegotiation, generateSlugId, ObjectID, createExpressError, getAgentClaim, parseDocumentID } from './utils.js'

/**
 * Create a new Linked Open Data object in RERUM v1.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * Respond RESTfully
 * */
const create = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let slug = ""
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
    
    let generatorAgent = getAgentClaim(req, next)
    let context = req.body["@context"] ? { "@context": req.body["@context"] } : {}
    let provided = JSON.parse(JSON.stringify(req.body))
    let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, provided, false, false)["__rerum"] }
    rerumProp.__rerum.slug = slug
    const providedID = provided._id
    const id = isValidID(providedID) ? providedID : ObjectID()
    delete provided["__rerum"]
    delete provided["@id"]
    // id is also protected in this case, so it can't be set.
    if(_contextid(provided["@context"])) delete provided.id
    delete provided["@context"]
    
    let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, provided, rerumProp, { "_id": id })
    console.log("CREATE")
    try {
        let result = await db.insertOne(newObject)
        res.set(utils.configureWebAnnoHeadersFor(newObject))
        newObject = idNegotiation(newObject)
        newObject.new_obj_state = JSON.parse(JSON.stringify(newObject))
        res.location(newObject[_contextid(newObject["@context"]) ? "id":"@id"])
        res.status(201)
        res.json(newObject)
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        next(createExpressError(error))
    }
}

/**
 * Query the MongoDB for objects containing the key:value pairs provided in the JSON Object in the request body.
 * This will support wildcards and mongo params like {"key":{$exists:true}}
 * The return is always an array, even if 0 or 1 objects in the return.
 * */
const query = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    if (Object.keys(props).length === 0) {
        //Hey now, don't ask for everything...this can happen by accident.  Don't allow it.
        let err = {
            message: "Detected empty JSON object.  You must provide at least one property in the /query request body JSON.",
            status: 400
        }
        next(createExpressError(err))
        return
    }
    try {
        let matches = await db.find(props).limit(limit).skip(skip).toArray()
        matches = matches.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(matches))
        res.json(matches)
    } catch (error) {
        next(createExpressError(error))
    }
}

/**
 * Query the MongoDB for objects with the _id provided in the request body or request URL
 * Note this specifically checks for _id, the @id pattern is irrelevant.  
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
const id = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    try {
        let match = await db.findOne({"$or": [{"_id": id}, {"__rerum.slug": id}]})
        if (match) {
            res.set(utils.configureWebAnnoHeadersFor(match))
            //Support built in browser caching
            res.set("Cache-Control", "max-age=86400, must-revalidate")
            //Support requests with 'If-Modified_Since' headers
            res.set(utils.configureLastModifiedHeader(match))
            // Include current version for optimistic locking
            const currentVersion = match.__rerum?.isOverwritten ?? ""
            res.set('Current-Overwritten-Version', currentVersion)
            match = idNegotiation(match)
            res.location(_contextid(match["@context"]) ? match.id : match["@id"])
            res.json(match)
            return
        }
        let err = {
            "message": `No RERUM object with id '${id}'`,
            "status": 404
        } 
        next(createExpressError(err))
    } catch (error) {
        next(createExpressError(error))
    }
}

export {
    create,
    query,
    id
}
