const config = require("../config")

/**
 * An internal helper for getting the agent from req.user
 * If you do not find an agent, the API does not know this requestor.
 * This means attribution is not possible, regardless of the state of the token.
 * The app is forbidden until registered with RERUM.  Access tokens are encoded with the agent.
 */
function getAgentClaim(req, next) {
    const claimKeys = [config.rerum.agent_claim, "http://devstore.rerum.io/v1/agent", "http://store.rerum.io/agent"]
    for (const claimKey of claimKeys) {
        const agent = req.user[claimKey]
        if (agent) {
            return agent
        }
    }
    let err = new Error("Could not get agent from req.user. Have you registered with RERUM?")
    err.status = 403
    next(createExpressError(err))
}

/**
 * 
 * @param {Object} update `message` and `status` for creating a custom Error
 * @param {Error} originalError `source` for tracing this Error
 * @returns Error for use in Express.next(err)
 */
function createExpressError(update, originalError = {}) {
    let err = Error("detected error", { cause: originalError })
    if (!update.code) {
        //Warning!  If 'update' is considered sent, this will cause a 500.  See notes above.
        update.statusMessage = update.message
        update.statusCode = update.status
        return Object.assign(err, update)
    }
    /**
     * Detection that createExpressError(error) passed in a mongo client error.
     * IMPORTANT!  If you try to write to 'update' when it comes in as a mongo error...
     * 
        POST /v1/api/create 500
        Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
     *
     * If you do update.statusMessage or update.statusCode YOU WILL CAUSE THIS ERROR.
     * Make sure you write to err instead.  Object.assign() will have the same result.
     */
    switch (update.code) {
        case 11000:
            //Duplicate _id key error, specific to SLUG support.  This is a Conflict.
            err.statusMessage = `The id provided in the Slug header already exists.  Please use a different Slug.`
            err.statusCode = 409
            break
        default:
            err.statusMessage = "There was a mongo error that prevented this request from completing successfully."
            err.statusCode = 500
    }
    return Object.assign(err, update)
}

exports = {
    createExpressError,
    getAgentClaim
}
