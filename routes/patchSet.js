const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const auth = require('../auth')
const rest = require('../rest.js')

router.route('/')
.patch(auth.checkJwt, controller.patchSet)
.post(auth.checkJwt, (req, res) => {
    if (rest.checkPatchOverrideSupport()) {
        controller.patchSet(req, resp)
    }
    else {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()
    }
})
    .all((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()
    })

module.exports = router
