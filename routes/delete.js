import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import { deleteObj } from '../controllers/delete.js'
import auth from '../auth/index.js'
import rest from '../rest.js'

router.route('/:_id')
    .delete(auth.checkJwt, deleteObj)
    .all((req, res, next) => {
        rest.sendMethodNotAllowed(res, 'Improper request method for deleting, please use DELETE.', 'DELETE')
    })

export default router
