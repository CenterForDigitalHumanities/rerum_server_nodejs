#!/usr/bin/env node

/**
 * Check this object for deleted status.  deleted objects in RERUM look like {"@id":"{some-id}", __deleted:{object properties}}
 */ 
const isDeleted = function(obj){
    return obj.hasOwnProperty("__deleted")
}

/**
 * Check this object for released status.  Released objects in RERUM look like {"@id":"{some-id}", __rerum:{"isReleased" : "ISO-DATE-TIME"}}
 */ 
const isReleased = function(obj){
    let bool = 
    (obj.hasOwnProperty("__rerum") && 
        obj.__rerum.hasOwnProperty("isReleased") && 
        obj.__rerum.isReleased !== "")
    return bool
}

/**
 * Check to see if the agent from the request (req.user had decoded token) matches the generating agent of the object in mongodb.
 */ 
const isGenerator = function(origObj, changeAgent){
    //If the object in mongo does not have a generator, something wrong.  however, there is no permission to check, no generator is the same as any generator.
    const generatingAgent = origObj.__rerum.generatedBy ?? changeAgent 
    //bots get a free pass through
    return generatingAgent === changeAgent
}

/**
 * Check if this object is of a known container type.  
 * If so, it requires a different header than a stand-alone resource object.
 * return boolean
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
 * Check if this object is a Linked Data object.
 * If so, it will have an @context -(TODO) that resolves!
 * return boolean
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

export default {
    isDeleted,
    isReleased,
    isGenerator,
    isContainerType,
    isLD
}