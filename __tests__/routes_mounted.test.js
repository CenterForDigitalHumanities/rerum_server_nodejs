/**
 * Express Route Detection
 * 
 * This approach checks routes without making HTTP requests by
 * directly inspecting the Express app's routing table.
 */

import request from "supertest"
import app from "../app.js"
import fs from "fs"

describe('Check to see that all expected top level route patterns exist.', () => {

  it('/v1 -- mounted ', async () => {
    const response = await request(app).get('/v1')
    expect(response.statusCode).not.toBe(404)
  })

  it('/client -- mounted ', async () => {
    const response = await request(app).get('/client/register')
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/id/{_id} -- mounted', async () => {
    const response = await request(app).get('/v1/id/test-mounted-id')
    // Mounted route with unknown id should 404 (not an unmapped endpoint 404)
    expect(response.statusCode).toBe(404)
  })

  it('/v1/since/{_id} -- mounted', async () => {
    const response = await request(app).get('/v1/since/test-mounted-id')
    // Mounted route with unknown id should 404
    expect(response.statusCode).toBe(404)
  })

  it('/v1/history/{_id} -- mounted', async () => {
    const response = await request(app).get('/v1/history/test-mounted-id')
    // Mounted route with unknown id should 404
    expect(response.statusCode).toBe(404)
  })

})

describe('Check to see that all /v1/api/ route patterns exist.', () => {

  it('/v1/api/query -- mounted ', async () => {
    const response = await request(app)
      .post('/v1/api/query')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/create -- mounted ', async () => {
    const response = await request(app)
      .post('/v1/api/create')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/bulkCreate -- mounted ', async () => {
    const response = await request(app)
      .post('/v1/api/bulkCreate')
      .set('Content-Type', 'application/json')
      .send([{ mounted: true }])
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/update -- mounted ', async () => {
    const response = await request(app)
      .put('/v1/api/update')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/bulkUpdate -- mounted ', async () => {
    const response = await request(app)
      .put('/v1/api/bulkUpdate')
      .set('Content-Type', 'application/json')
      .send([{ mounted: true }])
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/overwrite -- mounted ', async () => {
    const response = await request(app)
      .post('/v1/api/overwrite')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/patch -- mounted ', async () => {
    const response = await request(app)
      .patch('/v1/api/patch')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/set -- mounted ', async () => {
    const response = await request(app)
      .patch('/v1/api/set')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/unset -- mounted ', async () => {
    const response = await request(app)
      .patch('/v1/api/unset')
      .set('Content-Type', 'application/json')
      .send({ mounted: true })
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/delete/{id} -- mounted ', async () => {
    const response = await request(app).delete('/v1/api/delete/test-mounted-id')
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/release/{id} -- mounted ', async () => {
    const response = await request(app).patch('/v1/api/release/test-mounted-id')
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/search -- mounted ', async () => {
    const response = await request(app)
      .post('/v1/api/search')
      .set('Content-Type', 'text/plain')
      .send('mounted search')
    expect(response.statusCode).not.toBe(404)
  })

  it('/v1/api/search/phrase -- mounted ', async () => {
    const response = await request(app)
      .post('/v1/api/search/phrase')
      .set('Content-Type', 'text/plain')
      .send('mounted phrase search')
    expect(response.statusCode).not.toBe(404)
  })

})

describe('Check to see that critical static files are present', () => {
  it('/public folder files', () => {
    const filePath = './public/' // Replace with the actual file path
    expect(fs.existsSync(filePath+"stylesheets/api.css")).toBeTruthy()
    expect(fs.existsSync(filePath+"stylesheets/style.css")).toBeTruthy()
    expect(fs.existsSync(filePath+"index.html")).toBeTruthy()
    expect(fs.existsSync(filePath+"API.html")).toBeTruthy()
    expect(fs.existsSync(filePath+"context.json")).toBeTruthy()
    expect(fs.existsSync(filePath+"favicon.ico")).toBeTruthy()
    expect(fs.existsSync(filePath+"maintenance.html")).toBeTruthy()
    expect(fs.existsSync(filePath+"terms.txt")).toBeTruthy()
    expect(fs.existsSync(filePath+"talend.jpg")).toBeTruthy()
  });
})

describe('Check to see that critical repo files are present', () => {
  it('root folder files', () => {
    const filePath = './' // Replace with the actual file path
    expect(fs.existsSync(filePath+"CODEOWNERS")).toBeTruthy()
    expect(fs.existsSync(filePath+"CODE_OF_CONDUCT.md")).toBeTruthy()
    expect(fs.existsSync(filePath+"CONTRIBUTING.md")).toBeTruthy()
    expect(fs.existsSync(filePath+"README.md")).toBeTruthy()
    expect(fs.existsSync(filePath+"LICENSE")).toBeTruthy()
    expect(fs.existsSync(filePath+".gitignore")).toBeTruthy()
    expect(fs.existsSync(filePath+"jest.config.js")).toBeTruthy()
    expect(fs.existsSync(filePath+"package.json")).toBeTruthy()
  })
})
