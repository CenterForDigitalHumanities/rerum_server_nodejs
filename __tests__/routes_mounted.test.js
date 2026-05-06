/**
 * Express Route Detection
 * 
 * This approach checks routes without making HTTP requests by
 * directly inspecting the Express app's routing table.
 */

import request from "supertest"
import api_routes from "../routes/api-routes.js"
import app from "../app.js"
import fs from "fs"

let app_stack = app._router?.stack ?? []
let api_stack = api_routes.stack

/**
 * Check if a route exists in the Express app
 * @param {Array} stack - The router stack to search
 * @param {string} testPath - The path to test for
 * @returns {boolean} - True if the route exists
 */
function routeExists(stack, testPath) {
  for (const layer of stack) {
    // Check if layer has matchers (Express 5)
    if (layer.matchers && layer.matchers.length > 0) {
      const matcher = layer.matchers[0]
      const match = matcher(testPath)
      // Express 5 matchers may return boolean true or an object with path metadata
      if (match === true || (match && match.path)) return true
    }
    // Also check route.path directly if it exists
    if (layer.route && layer.route.path) {
      if (layer.route.path === testPath || layer.route.path.includes(testPath)) return true
    }
  }
  return false
}

describe('Check to see that all expected top level route patterns exist.', () => {

  it.todo('/v1 -- mounted ')
  it.todo('/client -- mounted ')
  it.todo('/v1/id/{_id} -- mounted')
  it.todo('/v1/since/{_id} -- mounted')
  it.todo('/v1/history/{_id} -- mounted')

})

describe('Check to see that all /v1/api/ route patterns exist.', () => {

  it.todo('/v1/api/query -- mounted ')
  it.todo('/v1/api/create -- mounted ')
  it.todo('/v1/api/bulkCreate -- mounted ')
  it.todo('/v1/api/update -- mounted ')
  it.todo('/v1/api/bulkUpdate -- mounted ')
  it.todo('/v1/api/overwrite -- mounted ')
  it.todo('/v1/api/patch -- mounted ')
  it.todo('/v1/api/set -- mounted ')
  it.todo('/v1/api/unset -- mounted ')
  it.todo('/v1/api/delete/{id} -- mounted ')
  it.todo('/v1/api/release/{id} -- mounted ')
  it.todo('/v1/api/search -- mounted ')
  it.todo('/v1/api/search/phrase -- mounted ')

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
