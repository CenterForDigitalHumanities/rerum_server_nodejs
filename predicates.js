/**
 * Check if object has been deleted in RERUM
 * @param {object} obj - Object to check for deletion status
 * @returns {boolean} True if object has __deleted property
 */
const isDeleted = function(obj){
    return obj.hasOwnProperty("__deleted")
}

/**
 * Check if object has been released (immutable) in RERUM
 * @param {object} obj - Object to check for release status
 * @returns {boolean} True if object has non-empty isReleased property
 */
const isReleased = function(obj){
    let bool = 
    (obj.hasOwnProperty("__rerum") && 
        obj.__rerum.hasOwnProperty("isReleased") && 
        obj.__rerum.isReleased !== "")
    return bool
}

/**
 * Check if requesting agent matches the object's generating agent
 * @param {object} origObj - Original object from database
 * @param {string} changeAgent - Agent URI from request token
 * @returns {boolean} True if agents match or no generator exists
 */
const isGenerator = function(origObj, changeAgent){
    //If the object in mongo does not have a generator, something wrong.  however, there is no permission to check, no generator is the same as any generator.
    const generatingAgent = origObj.__rerum.generatedBy ?? changeAgent 
    //bots get a free pass through
    return generatingAgent === changeAgent
}

/**
 * Check if object is a known container type requiring specific headers
 * @param {object} obj - Object to check for container type
 * @returns {boolean} True if object type matches known container types
 */
const isContainerType = function(obj){
    let answer = false
    let typestring = obj["@type"] ?? obj.type ?? ""
    const knownContainerTypes = [
        "ItemList",
        "AnnotationPage",
        "AnnotationList",
        "AnnotationCollection",
        "Sequence",
        "Range",
        "Canvas",
        "List",
        "Set",
        "Collection"
    ]
    for(const t of knownContainerTypes){
        //Dang those pesky prefixes...circumventing exact match for now
        if(typestring.includes(t)){
            answer = true
            break
        }
    }
    return answer
}

/**
 * Check if object is Linked Data compliant (has @context)
 * @param {object|Array} obj - Object or array to check for Linked Data compliance
 * @returns {boolean} True if object has @context property and is not an array
 */
const isLD = function(obj){
    //Note this is always false if obj is an array, like /since, /history or /query provide as a return.
    return Array.isArray(obj) ? false : obj["@context"] ? true : false
}

export {
    isDeleted,
    isReleased,
    isGenerator,
    isContainerType,
    isLD
}
