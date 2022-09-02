#!/usr/bin/env node
const router = require('express').Router()
const rewrite = require('express-urlrewrite')
const auth = require('../auth')
// This controller reroutes older style API calls.

router.use(rewrite("/:attemptedAction.action*", "/:attemptedAction$2"))
router.use(rewrite("/getByProperties*", "/query$1"))
router.use(rewrite("/batch_create", "/bulkCreate"))
router.post('/accessToken',auth.generateNewAccessToken)
router.post('/refreshToken',auth.generateNewRefreshToken)


module.exports = router
