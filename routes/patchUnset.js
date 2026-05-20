import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import auth from '../auth/index.js'
import rest from '../rest.js'

const checkPatchOverride = rest.createPatchOverrideMiddleware('Improper request method for updating, please use PATCH to remove keys from this object.')

router.route('/')
    .patch(auth.checkJwt, rest.verifyJsonContentType, controller.patchUnset)
    .post(auth.checkJwt, rest.verifyJsonContentType, checkPatchOverride, controller.patchUnset)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
        res.status(405).end()
    })

export default router
