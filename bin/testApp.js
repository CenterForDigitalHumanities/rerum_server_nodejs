#!/usr/bin/env node

/**
 * @author thehabes
 * */

/**
 * Module dependencies.
 */
const jest = require('jest')
const runCLI = require('jest-cli')
//const defaults = require('../jest.config.js')
var app = require('../app')
var http = require('http')


/**
 * Get port from environment and store in Express.
 */

var port = normalizePort('3333')
app.set('port', port)

/**
 * Create HTTP server.
 */

var server = http.createServer(app)

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port)
server.on('error', onError)
server.on('listening', onListening)

/**
 * Control the keep alive header
 */ 
// Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout
server.keepAliveTimeout = 8 * 1000 //8 seconds
// Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363
server.headersTimeout = 8.5 * 1000 //8 seconds

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  const portCheck = parseInt(val, 10)

  if (isNaN(portCheck)) {
    // named pipe
    return val
  }

  if (portCheck >= 0) {
    // port number
    return portCheck
  }

  return false
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error
  }

  var bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges')
      process.exit(1)
      break
    case 'EADDRINUSE':
      console.error(bind + ' is already in use')
      process.exit(1)
      break
    default:
      throw error
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

async function onListening() {
  console.log("LISTENING ON "+port)
  //Ideally, create and then blow this away.
  process.env.MONGODBNAME="annotationStoreTesting"
  jest.runCLI(
    {
      "colors" : "true"
    }, 
    ["jest.config.js"])
    .then(({ results }) => {
      if (results.success) {
        console.log('Tests completed')
        process.exit(0)
      } 
      else {
        console.error('Tests failed')
        process.exit(1)
      }
  })
}

