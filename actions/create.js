import httpUtils from "./Request.js"
import utils from "../utils.js"

/**
 * Create a new Linked Open Data object in RERUM v1.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * Respond RESTfully
 * */
export default create = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const metadata = {}
    metadata.slug = req.header("Slug")
    metadata.generator = httpUtils.getAgentClaim(req, next)
    const providedDocument = JSON.parse(JSON.stringify(req.body))
    delete providedDocument["_rerum"]
    delete providedDocument["_id"]
    delete providedDocument["@id"]
    delete providedDocument["id"]
    try {
        const result = insert(providedDocument, metadata)
        res.set(utils.configureWebAnnoHeadersFor(result))
        res.location(result["@id"])
        res.status(201)
        result.new_obj_state = JSON.parse(JSON.stringify(result))
        res.json(result)
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        next(httpUtils.createExpressError(error))
    }
}
