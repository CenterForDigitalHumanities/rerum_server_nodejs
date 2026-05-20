#!/usr/bin/env node
import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import rest from '../rest.js'
import auth from '../auth/index.js'

const checkPatchOverride = rest.createPatchOverrideMiddleware('Improper request method for updating, please use PATCH to alter existing keys on this object.')

router.route('/')
	.patch(auth.checkJwt, rest.verifyJsonContentType, controller.patchUpdate)
	.post(auth.checkJwt, rest.verifyJsonContentType, checkPatchOverride, controller.patchUpdate)
	.all((req, res, next) => {
		res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
		res.status(405).end()
	})

export default router
