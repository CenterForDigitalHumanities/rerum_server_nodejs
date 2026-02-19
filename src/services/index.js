import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
const router = express.Router()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/* GET home page. */
router.get('/', (req, res, next) => {
  res.sendFile('index.html', { root: path.join(__dirname, '../../public') })
})

export default router
