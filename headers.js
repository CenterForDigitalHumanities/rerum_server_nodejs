#!/usr/bin/env node

import utilsPred from './predicates.js'

/**
 * Mint the HTTP response headers required by REST best practices and/or Web Annotation standards.
 * return a JSON object.  keys are header names, values are header values.
 */
const configureWebAnnoHeadersFor = function(obj){
    let headers = {}
    if(utilsPred.isLD(obj)){
        headers["Content-Type"] = "application/ld+json;charset=utf-8;profile=\"http://www.w3.org/ns/anno.jsonld\""
    }
    if(utilsPred.isContainerType(obj)){
        headers["Link"] = "application/ld+json;charset=utf-8;profile=\"http://www.w3.org/ns/anno.jsonld\""
    }
    else{
        headers["Link"] = "<http://www.w3.org/ns/ldp#Resource>; rel=\"type\""
    }
    headers["Allow"] = "GET,OPTIONS,HEAD,PUT,PATCH,DELETE,POST"
    return headers
}

/**
 * Mint the HTTP response headers required by REST best practices and/or Linked Data standards.
 * This is specifically for responses that are not Web Annotation compliant (getByProperties, getAllDescendants, getAllAncestors)
 * They respond with Arrays (which have no @context), but they still need the JSON-LD support headers.
 * return a JSON object.  keys are header names, values are header values.
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
 * Mint the Last-Modified header for /v1/id/ responses.
 * It should be displayed like Mon, 14 Mar 2022 22:44:42 GMT
 * The data knows it like 2022-03-14T17:44:42.721
 * return a JSON object.  keys are header names, values are header values.
 */
const configureLastModifiedHeader = function(obj){
    let date = ""
    if(obj.__rerum){
        if(!obj.__rerum.isOverwritten === ""){
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

export default {
    configureWebAnnoHeadersFor,
    configureLDHeadersFor,
    configureLastModifiedHeader
}