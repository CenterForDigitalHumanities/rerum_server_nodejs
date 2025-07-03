#!/usr/bin/env node

/**
 * History controller for RERUM operations
 * Handles history, since, and HEAD request operations
 * @author Claude Sonnet 4, cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation, getAllVersions, getAllAncestors, getAllDescendants } from './utils.js'

/**
 * Public facing servlet to gather for all versions downstream from a provided `key object`.
 * @param oid variable assigned by urlrewrite rule for /id in urlrewrite.xml
 * @throws java.lang.Exception
 * @respond JSONArray to the response out for parsing by the client application.
 */
const since = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: `Cannot produce a history. There is no object in the database with id '${id}'.  Check the URL.`,
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let descendants = getAllDescendants(all, obj, [])
    descendants =
        descendants.map(o => idNegotiation(o))
    res.set(utils.configureLDHeadersFor(descendants))
    res.json(descendants)
}

/**
 * Public facing servlet action to find all upstream versions of an object.  This is the action the user hits with the API.
 * If this object is `prime`, it will be the only object in the array.
 * @param oid variable assigned by urlrewrite rule for /id in urlrewrite.xml
 * @respond JSONArray to the response out for parsing by the client application.
 * @throws Exception 
 */
const history = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: `Cannot produce a history. There is no object in the database with id '${id}'.  Check the URL.`,
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let ancestors = getAllAncestors(all, obj, [])
    ancestors =
        ancestors.map(o => idNegotiation(o))
    res.set(utils.configureLDHeadersFor(ancestors))
    res.json(ancestors)
}

/**
 * Allow for HEAD requests by @id via the RERUM getByID pattern /v1/id/
 * No object is returned, but the Content-Length header is set. 
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
const idHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    try {
        let match = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        if (match) {
            const size = Buffer.byteLength(JSON.stringify(match))
            res.set("Content-Length", size)
            res.sendStatus(200)
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

/**
 * Allow for HEAD requests via the RERUM getByProperties pattern /v1/api/query
 * No objects are returned, but the Content-Length header is set. 
 */
const queryHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    try {
        let matches = await db.find(props).toArray()
        if (matches.length) {
            const size = Buffer.byteLength(JSON.stringify(matches))
            res.set("Content-Length", size)
            res.sendStatus(200)
            return
        }
        let err = {
            "message": `There are no objects in the database matching the query. Check the request body.`,
            "status": 404
        } 
        next(createExpressError(err))
    } catch (error) {
        next(createExpressError(error))
    }
}

/**
 * Allow for HEAD requests via the RERUM since pattern /v1/since/:_id
 * No objects are returned, but the Content-Length header is set. 
 * */
const sinceHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: `Cannot produce a history. There is no object in the database with id '${id}'.  Check the URL.`,
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let descendants = getAllDescendants(all, obj, [])
    if (descendants.length) {
        const size = Buffer.byteLength(JSON.stringify(descendants))
        res.set("Content-Length", size)
        res.sendStatus(200)
        return
    }
    res.set("Content-Length", 0)
    res.sendStatus(200)
}

/**
 * Allow for HEAD requests via the RERUM since pattern /v1/history/:_id
 * No objects are returned, but the Content-Length header is set. 
 * */
const historyHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: "Cannot produce a history. There is no object in the database with this id. Check the URL.",
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let ancestors = getAllAncestors(all, obj, [])
    if (ancestors.length) {
        const size = Buffer.byteLength(JSON.stringify(ancestors))
        res.set("Content-Length", size)
        res.sendStatus(200)
        return
    }
    res.set("Content-Length", 0)
    res.sendStatus(200)
}

export { since, history, idHeadRequest, queryHeadRequest, sinceHeadRequest, historyHeadRequest }
