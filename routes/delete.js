import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import { deleteObj } from '../controllers/delete.js'
import auth from '../auth/index.js'

router.route('/:_id')
    .delete(auth.checkJwt, deleteObj)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405).end()
    })

export default router
