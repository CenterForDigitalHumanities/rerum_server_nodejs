import { isLD, isContainerType } from './predicates.js'

/**
 * Configure HTTP response headers for Web Annotation compliant objects
 * @param {object} obj - The object to configure headers for
 * @returns {object} HTTP headers object with Content-Type, Link, and Allow headers
 */
const configureWebAnnoHeadersFor = function(obj){
    let headers = {}
    if(isLD(obj)){
        headers["Content-Type"] = "application/ld+json;charset=utf-8;profile=\"http://www.w3.org/ns/anno.jsonld\""
    }
    if(isContainerType(obj)){
        headers["Link"] = "application/ld+json;charset=utf-8;profile=\"http://www.w3.org/ns/anno.jsonld\""
    }
    else{
        headers["Link"] = "<http://www.w3.org/ns/ldp#Resource>; rel=\"type\""
    }
    headers["Allow"] = "GET,OPTIONS,HEAD,PUT,PATCH,DELETE,POST"
    return headers
}

/**
 * Build HTTP response headers for responses that should expose
 * Linked Data semantics but are not strictly Web Annotation-compliant.
 *
 * This is mainly used for endpoints that return arrays, such as
 * query/history/since-style responses. Since arrays do not include
 * an `@context`, this function explicitly provides JSON-LD-related
 * headers so the response still advertises Linked Data support.
 *
 * @param {object|Array} obj - The response payload being evaluated. Typically an array of Linked Data objects.
 * @returns {Object.<string, string>} An object containing HTTP response headers for Linked Data responses.
 */
const configureLDHeadersFor = function(obj){
    //Note that the optimal situation would be to be able to detect the LD-ness of this object
    //What we have are the arrays returned from the aformentioned getters (/query, /since, /history)
    //We know we want them to be LD and that they likely contain LD things, but the arrays don't have an @context
    let headers = {}
    /**
    if(isLD(obj)){
        headers["Content-Type"] = 'application/ld+json;charset=utf-8;profile="http://www.w3.org/ns/anno.jsonld"'
    } 
    else {
        // This breaks Web Annotation compliance, but allows us to return requested
        // objects without misrepresenting the content.
        headers["Content-Type"] = "application/json;charset=utf-8;"
    }
    */
    headers["Allow"] = "GET,OPTIONS,HEAD,PUT,PATCH,DELETE,POST"
    headers["Content-Type"] = 'application/ld+json;charset=utf-8;profile="http://www.w3.org/ns/anno.jsonld"'
    headers["Link"] = '<http://store.rerum.io/v1/context.json>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
    return headers
}

/**
 * Build the Last-Modified HTTP header for a RERUM resource response.
 *
 * The timestamp is derived from RERUM metadata:
 * - `obj.__rerum.isOverwritten` if present
 * - otherwise `obj.__rerum.createdAt`
 * - or `obj.__deleted.time` for deleted resources
 *
 * Fractional seconds are removed before conversion because browser
 * HTTP date headers are rounded to whole seconds.
 *
 * @param {object} obj - The resource object containing `__rerum` or `__deleted` metadata.
 * @returns {Object.<string, string>} An object containing the Last-Modified header in UTC string format.
 */
const configureLastModifiedHeader = function(obj){
    let date = ""
    if(obj.__rerum){
        if(obj.__rerum.isOverwritten !== ""){
            date = obj.__rerum.isOverwritten
        }
        else{
            date = obj.__rerum.createdAt
        }
    }
    else if(obj.__deleted){
        date = obj.__deleted.time
    }
    //Note that dates like 2021-05-26T10:39:19.328 have been rounded to 2021-05-26T10:39:19 in browser headers.  Account for that here.
    if(typeof date === "string" && date.includes(".")){
        //If-Modified-Since and Last-Modified headers are rounded.  Wed, 26 May 2021 10:39:19.629 GMT becomes Wed, 26 May 2021 10:39:19 GMT.
        date = date.split(".")[0]
    }
    return {"Last-Modified":new Date(date).toUTCString()}
}

export {
    configureWebAnnoHeadersFor,
    configureLDHeadersFor,
    configureLastModifiedHeader
}
