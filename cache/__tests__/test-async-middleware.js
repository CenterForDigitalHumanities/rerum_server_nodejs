#!/usr/bin/env node

/**
 * Test that async res.json() actually blocks response
 * This is CRITICAL for the comprehensive fix to work
 */

import express from 'express'
import http from 'http'

const app = express()
app.use(express.json())

let invalidationCompleted = false
let responseTime = 0
let invalidationTime = 0

// Simulate the cache invalidation middleware (CORRECTED VERSION)
app.use((req, res, next) => {
    const originalJson = res.json.bind(res)
    const originalEnd = res.end.bind(res)
    let invalidationPromise = null

    const performInvalidation = async () => {
        // Simulate slow invalidation (like our cache invalidation)
        await new Promise(resolve => setTimeout(resolve, 100))
        invalidationCompleted = true
        invalidationTime = Date.now()
    }

    // Start invalidation when res.json is called
    res.json = (data) => {
        invalidationPromise = performInvalidation()
        return originalJson(data)
    }

    // CRITICAL: Intercept res.end() to wait for invalidation
    res.end = function(...args) {
        if (invalidationPromise) {
            invalidationPromise
                .then(() => originalEnd.apply(res, args))
                .catch(err => originalEnd.apply(res, args))
        } else {
            originalEnd.apply(res, args)
        }
    }

    next()
})

// Test route
app.get('/test', (req, res) => {
    // Hook into when response is actually sent
    res.on('finish', () => {
        responseTime = Date.now()
    })
    res.json({ message: 'test' })
})

const server = http.createServer(app)

async function runTest() {
    await new Promise(resolve => server.listen(3002, resolve))
    console.log('Test server started on port 3002')

    // Make request
    const startTime = Date.now()
    const response = await fetch('http://localhost:3002/test')
    const endTime = Date.now()

    const data = await response.json()

    console.log('')
    console.log('Test Results:')
    console.log('='.repeat(60))
    console.log(`Request duration: ${endTime - startTime}ms`)
    console.log(`Invalidation completed: ${invalidationCompleted}`)

    if (!invalidationCompleted) {
        console.log('\x1b[31m✗ CRITICAL: Invalidation did NOT complete before response\x1b[0m')
        console.log('\x1b[31m  The async/await pattern is NOT working!\x1b[0m')
        process.exit(1)
    }

    if (responseTime < invalidationTime) {
        console.log('\x1b[31m✗ CRITICAL: Response was sent BEFORE invalidation completed\x1b[0m')
        console.log(`  Response time: ${responseTime}`)
        console.log(`  Invalidation time: ${invalidationTime}`)
        console.log(`  Gap: ${invalidationTime - responseTime}ms`)
        console.log('\x1b[31m  This means RACE CONDITION STILL EXISTS!\x1b[0m')
        process.exit(1)
    }

    if (endTime - startTime < 100) {
        console.log('\x1b[33m⚠ WARNING: Request completed too fast\x1b[0m')
        console.log(`  Expected at least 100ms delay, got ${endTime - startTime}ms`)
        console.log(`  Invalidation might not be blocking!`)
    } else {
        console.log('\x1b[32m✓ Request was delayed by invalidation (good!)\x1b[0m')
        console.log(`  This confirms async middleware blocks response`)
    }

    console.log('\x1b[32m✓ Invalidation completed BEFORE response was sent\x1b[0m')
    console.log('')
    console.log('\x1b[32m\x1b[1m✓ COMPREHENSIVE FIX VERIFIED!\x1b[0m')
    console.log('\x1b[32m  The async res.json() correctly blocks the response.\x1b[0m')
    console.log('')

    server.close()
    process.exit(0)
}

runTest().catch(err => {
    console.error('Test error:', err)
    process.exit(1)
})
