const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const auth = require('../auth')
const rest = require('../rest.js')

router.route('/')
    .patch(auth.checkJwt, controller.patchUnset)
    .post(auth.checkJwt, (req, res, next) => {
        if (rest.checkPatchOverrideSupport(req, res)) {
            controller.patchUnset(req, res, next)
        }
        else {
            res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
            res.status(405)
            next()
        }
    }) 
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
        res.status(405)
        next(res)
    })

module.exports = router
