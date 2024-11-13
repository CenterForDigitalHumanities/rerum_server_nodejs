import express from 'express'
const router = express.Router()

/* GET home page. */
router.get('/', (req, res, next) => {
  res.render('index', { title: 'RERUM' })
})

export default router
