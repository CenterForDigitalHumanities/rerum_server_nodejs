#!/usr/bin/env node

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

var port = normalizePort(process.env.PORT || '3333')
app.set('port', port)

/**
 * Create HTTP server.
 */

var server = http.createServer(app)
const io = require('socket.io')(server)

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port)
server.on('error', onError)
server.on('listening', onListening)

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
  jest.runCLI(
    {
      "colors":true, 
      // "detectOpenHandles":true, 
      // "noStackTrace":true,
    }, 
    ["jest.config.js"])
    .then(({ results }) => {
      if (results.success) {
        console.log(`Tests completed`)
        process.exit(1)
      } 
      else {
        console.error(`Tests failed`)
        process.exit(0)
      }
  })
}

/**
 * Socket magic for npm stop
 * */
io.on('connection', (socketServer) => {
  socketServer.on('npmStop', () => {
    process.exit(0)
  })
})

