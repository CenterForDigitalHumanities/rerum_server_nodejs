# Cache Test Suite Documentation

## Overview

The cache testing suite includes two test files that provide comprehensive coverage of the RERUM API caching layer using **PM2 Cluster Cache**:

1. **`cache.test.js`** - Middleware functionality and invalidation tests (69 tests)
2. **`cache-limits.test.js`** - Limit enforcement tests (23 tests)

## Test Execution

### Run All Cache Tests
```bash
npm run runtest -- cache/__tests__/
```

### Run Individual Test Files
```bash
# Middleware tests
npm run runtest -- cache/__tests__/cache.test.js

# Limit enforcement tests
npm run runtest -- cache/__tests__/cache-limits.test.js
```

### Expected Results
```
✅ Test Suites: 2 passed, 2 total
✅ Tests:       90 passed, 90 total
⚡ Time:        ~27s
```

**Note**: Tests take ~27 seconds due to PM2 cluster synchronization timing (cache operations have built-in delays for cross-worker consistency).

---

## cache.test.js - Middleware Functionality (69 tests)

### ✅ Read Endpoint Caching (23 tests)

#### 1. cacheQuery Middleware (5 tests)
- ✅ Pass through on non-POST requests
- ✅ Return cache MISS on first request
- ✅ Return cache HIT on second identical request  
- ✅ Respect pagination parameters in cache key
- ✅ Create different cache keys for different query bodies

#### 2. cacheSearch Middleware (4 tests)
- ✅ Pass through on non-POST requests
- ✅ Return cache MISS on first search
- ✅ Return cache HIT on second identical search
- ✅ Handle search with options object

#### 3. cacheSearchPhrase Middleware (2 tests)
- ✅ Return cache MISS on first phrase search
- ✅ Return cache HIT on second identical phrase search

#### 4. cacheId Middleware (3 tests)
- ✅ Pass through on non-GET requests
- ✅ Return cache MISS on first ID lookup
- ✅ Return cache HIT on second ID lookup
- ✅ Cache different IDs separately

#### 5. cacheHistory Middleware (2 tests)
- ✅ Return cache MISS on first history request
- ✅ Return cache HIT on second history request

#### 6. cacheSince Middleware (2 tests)
- ✅ Return cache MISS on first since request
- ✅ Return cache HIT on second since request

#### 7. cacheGogFragments Middleware (3 tests)
- ✅ Pass through when ManuscriptWitness is missing
- ✅ Pass through when ManuscriptWitness is invalid (not a URL)
- ✅ Return cache MISS on first request
- ✅ Return cache HIT on second identical request
- ✅ Cache based on pagination parameters

#### 8. cacheGogGlosses Middleware (3 tests)
- ✅ Pass through when ManuscriptWitness is missing
- ✅ Pass through when ManuscriptWitness is invalid (not a URL)
- ✅ Return cache MISS on first request
- ✅ Return cache HIT on second identical request
- ✅ Cache based on pagination parameters

### ✅ Cache Management (4 tests)

#### cacheStats Endpoint (2 tests)
- ✅ Return cache statistics at top level (hits, misses, hitRate, length, bytes, etc.)
- ✅ Include details array when requested with `?details=true`

#### Cache Integration (2 tests)
- ✅ Maintain separate caches for different endpoints
- ✅ Only cache successful responses (skip 404s, errors)

### ✅ Cache Statistics (2 tests)
- ✅ Track hits and misses correctly
- ✅ Track cache size (additions and deletions)

### ✅ Cache Invalidation Tests (40 tests)

These tests verify smart cache invalidation across PM2 cluster workers:

#### invalidateByObject (7 tests)
- ✅ Invalidate matching query caches when object is created
- ✅ Not invalidate non-matching query caches
- ✅ Invalidate search caches
- ✅ Invalidate searchPhrase caches
- ✅ Not invalidate id, history, or since caches
- ✅ Handle invalid input gracefully
- ✅ Track invalidation count in stats

#### objectMatchesQuery (3 tests)
- ✅ Match simple property queries
- ✅ Match queries with body property
- ✅ Match nested property queries

#### objectContainsProperties (10 tests)
- ✅ Skip pagination parameters
- ✅ Skip __rerum and _id properties
- ✅ Match simple properties
- ✅ Match nested objects
- ✅ Handle $exists operator
- ✅ Handle $ne operator
- ✅ Handle comparison operators ($gt, $gte, $lt, $lte)
- ✅ Handle $size operator for arrays
- ✅ Handle $or operator
- ✅ Handle $and operator

#### getNestedProperty (4 tests)
- ✅ Get top-level properties
- ✅ Get nested properties with dot notation
- ✅ Return undefined for missing properties
- ✅ Handle null/undefined gracefully

#### evaluateFieldOperators (4 tests)
- ✅ Evaluate $exists correctly
- ✅ Evaluate $size correctly
- ✅ Evaluate comparison operators correctly
- ✅ Be conservative with unknown operators

#### evaluateOperator (4 tests)
- ✅ Evaluate $or correctly
- ✅ Evaluate $and correctly
- ✅ Be conservative with unknown operators
- ✅ Handle invalid input gracefully

---

## What cache.test.js Does NOT Test

### ❌ Real Database Integration

**Not tested**:
- Actual MongoDB operations
- Real RERUM object creation/updates with `__rerum` metadata
- Version chain creation from UPDATE operations
- Physical cache invalidation with live database writes

**Why mocks can't test this**:
- Tests use mock req/res objects, not real MongoDB
- Invalidation logic is tested, but not with actual database-created objects
- Tests verify the *logic* works, but not end-to-end with MongoDB

**Solution**: Integration tests with real server and database validate this

---

### ❌ TTL Expiration in Production

**Not tested**:
- Long TTL expiration (default 86400000ms = 24 hours)
- PM2 automatic eviction over time
- Memory cleanup after TTL expires

**Why mocks can't test this**:
- Would require 24+ hour test runs
- PM2 handles TTL internally
- cache-limits.test.js tests short TTLs (1 second) to verify mechanism works

**Solution**: cache-limits.test.js validates TTL with short timeouts

---

### ❌ PM2 Multi-Worker Synchronization Under Load

**Not tested in cache.test.js**:
- Concurrent writes from multiple PM2 workers
- Cache consistency under high request volume
- Race conditions between workers
- Network latency in cluster cache sync

**Why unit tests can't test this**:
- Requires actual PM2 cluster with multiple worker processes
- Requires load testing tools
- Requires production-like environment

**Solution**: PM2 Cluster Cache library handles this (tested by PM2 maintainers)

---

## cache-limits.test.js - Limit Enforcement (23 tests)

### Purpose

Tests PM2 Cluster Cache limit configuration and enforcement for:
- **TTL (Time-To-Live)**: Entry expiration after configured timeout
- **maxLength**: Maximum number of cache entries (1000 default)
- **maxBytes**: Maximum cache size in bytes (1GB default)

**Important**: PM2 Cluster Cache handles automatic eviction based on these limits. Tests verify the limits are properly configured and enforced, not that we manually implement eviction logic.

---

### ✅ TTL (Time-To-Live) Limit Enforcement (4 tests)

#### 1. Entry Expiration
- ✅ Entries expire after TTL timeout
- ✅ Returns null for expired entries
- ✅ Works with short TTL (1 second test)

#### 2. Default TTL
- ✅ Respects default TTL from constructor (86400000ms = 24 hours)
- ✅ Entries exist within TTL period
- ✅ TTL value reported in stats

#### 3. Custom TTL Per Entry
- ✅ Allows setting custom TTL when calling `set()`
- ✅ Custom TTL overrides default
- ✅ Expires entries with custom timeout

#### 4. TTL Across Cache Key Types
- ✅ Enforces TTL for query cache keys
- ✅ Enforces TTL for search cache keys
- ✅ Enforces TTL for id cache keys
- ✅ All cache types expire consistently

---

### ✅ maxLength Limit Configuration (5 tests)

#### 1. Default Configuration
- ✅ maxLength configured to 1000 by default
- ✅ Value accessible via `cache.maxLength`

#### 2. Stats Reporting
- ✅ maxLength reported in `cache.getStats()`
- ✅ Stats value matches cache property

#### 3. Current Length Tracking
- ✅ Tracks current cache size via `allKeys`
- ✅ Length increases when entries added
- ✅ Stats reflect actual cache size

#### 4. PM2 Automatic Enforcement
- ✅ PM2 Cluster Cache enforces maxLength automatically
- ✅ Eviction stats tracked in `stats.evictions`

#### 5. Environment Variable Override
- ✅ Respects `CACHE_MAX_LENGTH` environment variable
- ✅ Falls back to 1000 if not set

---

### ✅ maxBytes Limit Configuration (4 tests)

#### 1. Default Configuration
- ✅ maxBytes configured to 1GB (1000000000) by default
- ✅ Value accessible via `cache.maxBytes`

#### 2. Stats Reporting
- ✅ maxBytes reported in `cache.getStats()`
- ✅ Stats value matches cache property

#### 3. PM2 Monitoring
- ✅ PM2 Cluster Cache monitors byte size
- ✅ Limit configured for memory safety

#### 4. Environment Variable Override
- ✅ Respects `CACHE_MAX_BYTES` environment variable
- ✅ Falls back to 1000000000 if not set

---

### ✅ Combined Limits Configuration (4 tests)

#### 1. All Limits Configured
- ✅ maxLength = 1000
- ✅ maxBytes = 1000000000
- ✅ TTL = 86400000

#### 2. All Limits in Stats
- ✅ All three limits reported by `getStats()`
- ✅ Values match cache properties

#### 3. Environment Variable Respect
- ✅ All three limits respect environment variables
- ✅ Proper fallback to defaults

#### 4. Reasonable Limit Values
- ✅ maxLength: 0 < value < 1,000,000
- ✅ maxBytes: 0 < value < 10GB
- ✅ TTL: 0 < value < 1 day

---

### ✅ Eviction Stats Tracking (2 tests)

#### 1. Eviction Count
- ✅ Stats include `evictions` property
- ✅ Count is a number >= 0

#### 2. Clear Increments Evictions
- ✅ `cache.clear()` increments eviction count
- ✅ Stats updated after clear

---

### ✅ Breaking Change Detection (4 tests)

#### 1. Limit Properties Exist
- ✅ `cache.maxLength` property exists
- ✅ `cache.maxBytes` property exists
- ✅ `cache.ttl` property exists

#### 2. Stats Properties Exist
- ✅ `stats.maxLength` property exists
- ✅ `stats.maxBytes` property exists
- ✅ `stats.ttl` property exists
- ✅ `stats.evictions` property exists
- ✅ `stats.length` property exists

#### 3. PM2 Cluster Cache Available
- ✅ `cache.clusterCache` is defined
- ✅ `clusterCache.set()` function exists
- ✅ `clusterCache.get()` function exists
- ✅ `clusterCache.flush()` function exists

#### 4. Default Values Unchanged
- ✅ maxLength defaults to 1000 (if env var not set)
- ✅ maxBytes defaults to 1000000000 (if env var not set)
- ✅ TTL defaults to 86400000 (if env var not set)

---

## What cache-limits.test.js Does NOT Test

### ❌ Manual Eviction Logic

**Not tested**:
- Custom LRU eviction algorithms
- Manual byte-size tracking during operations
- Manual entry removal when limits exceeded

**Why**:
- PM2 Cluster Cache handles eviction automatically
- We configure limits, PM2 enforces them
- Tests verify configuration, not implementation

---

### ❌ Eviction Order (LRU/FIFO)

**Not tested**:
- Which specific entries are evicted first
- Least-recently-used vs. first-in-first-out
- Access time tracking

**Why**:
- PM2 Cluster Cache internal implementation detail
- Eviction strategy may change in PM2 updates
- Tests focus on: "Are limits enforced?" not "How are they enforced?"

---

### ❌ Large-Scale Memory Pressure

**Not tested**:
- Adding 10,000+ entries to hit maxLength
- Adding entries until 1GB maxBytes reached
- System behavior under memory pressure

**Why**:
- Would make tests very slow (minutes instead of seconds)
- PM2 Cluster Cache tested by its maintainers for scale
- Tests verify limits are *configured*, not stress-test enforcement

---

### ❌ Multi-Worker Eviction Synchronization

**Not tested**:
- Evictions synchronized across PM2 workers
- Consistent cache state after eviction in cluster
- Race conditions during simultaneous evictions

**Why**:
- Requires actual PM2 cluster with multiple workers
- PM2 Cluster Cache library handles this
- Tests run in single-process Jest environment

---

## Key Differences from Previous Version

### Before (Old cache-limits.test.js)
- ❌ Tested custom eviction logic (we don't implement this anymore)
- ❌ Manually tracked byte size (PM2 does this now)
- ❌ Manual LRU eviction (PM2 handles this)
- ❌ Custom limit enforcement code (removed - PM2 does it)

### After (Current cache-limits.test.js)
- ✅ Tests PM2 Cluster Cache limit **configuration**
- ✅ Verifies limits are properly set from constructor/env vars
- ✅ Tests TTL expiration (PM2 enforces this)
- ✅ Verifies stats accurately report limits
- ✅ Tests breaking changes (limit properties/stats removed)

### Philosophy Change

**Old approach**: "We implement eviction, test our implementation"
**New approach**: "PM2 implements eviction, test our configuration"

This is more maintainable and reliable - we leverage PM2's battle-tested eviction instead of rolling our own.

---

## Test Structure

### Mock Objects (cache.test.js)

Each test uses mock Express request/response objects:

```javascript
mockReq = {
    method: 'GET',
    body: {},
    query: {},
    params: {},
    locals: {}
}

mockRes = {
    statusCode: 200,
    headers: {},
    locals: {},
    set: jest.fn(function(key, value) {
        if (typeof key === 'object') {
            Object.assign(this.headers, key)
        } else {
            this.headers[key] = value
        }
        return this
    }),
    json: jest.fn(function(data) {
        this.jsonData = data
        return this
    })
}

mockNext = jest.fn()
```

### Typical Test Pattern (cache.test.js)

```javascript
it('should return cache HIT on second identical request', async () => {
    // Setup request
    mockReq.method = 'POST'
    mockReq.body = { type: 'Annotation' }
    
    // First request - MISS
    await cacheQuery(mockReq, mockRes, mockNext)
    expect(mockRes.headers['X-Cache']).toBe('MISS')
    expect(mockNext).toHaveBeenCalled()
    
    // Simulate controller response
    mockRes.json([{ id: '123' }])
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Reset mocks
    mockRes = createMockResponse()
    mockNext = jest.fn()
    
    // Second request - HIT
    await cacheQuery(mockReq, mockRes, mockNext)
    
    // Verify
    expect(mockRes.headers['X-Cache']).toBe('HIT')
    expect(mockRes.json).toHaveBeenCalledWith([{ id: '123' }])
    expect(mockNext).not.toHaveBeenCalled()
})
```

### Helper Functions (cache-limits.test.js)

```javascript
// Wait for PM2 cluster cache synchronization
async function waitForCache(ms = 100) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// Get actual cache size from PM2 cluster
async function getCacheSize() {
    const keysMap = await cache.clusterCache.keys()
    const uniqueKeys = new Set()
    for (const instanceKeys of Object.values(keysMap)) {
        if (Array.isArray(instanceKeys)) {
            instanceKeys.forEach(key => {
                if (!key.startsWith('_stats_worker_')) {
                    uniqueKeys.add(key)
                }
            })
        }
    }
    return uniqueKeys.size
}
```

---

## Extending the Tests

### Adding Tests for New Cached Endpoints

If you add a new cached endpoint:

1. **Add to cache.test.js** - Test the middleware caching behavior:
```javascript
describe('cacheMyNewEndpoint middleware', () => {
    beforeEach(async () => {
        await cache.clear()
    })
    
    it('should return cache MISS on first request', async () => {
        // Test MISS behavior
    })
    
    it('should return cache HIT on second identical request', async () => {
        // Test HIT behavior
    })
})
```

2. **Add invalidation tests** - If the endpoint should be invalidated:
```javascript
describe('Cache Invalidation Tests', () => {
    describe('invalidateByObject', () => {
        it('should invalidate myNewEndpoint cache on create', async () => {
            // Test invalidation
        })
    })
})
```

3. **Run tests**: `npm run runtest -- cache/__tests__/cache.test.js`

### Adding Tests for New Limit Types

If you add a new limit (e.g., maxKeys per query pattern):

1. **Add to cache-limits.test.js**:
```javascript
describe('Cache maxKeysPerPattern Limit Configuration', () => {
    it('should have maxKeysPerPattern configured', () => {
        expect(cache.maxKeysPerPattern).toBeDefined()
    })
    
    it('should report maxKeysPerPattern in stats', async () => {
        const stats = await cache.getStats()
        expect(stats.maxKeysPerPattern).toBeDefined()
    })
})
```

2. **Run tests**: `npm run runtest -- cache/__tests__/cache-limits.test.js`

---

## Troubleshooting

### Tests Failing After Code Changes

1. **Check PM2 timing**: Cache operations are async and require wait time
   - Use `await waitForCache(100)` after cache operations
   - Increase wait time if tests are intermittently failing

2. **Verify cache clearing**: Tests should clear cache before/after
   ```javascript
   beforeEach(async () => {
       await cache.clear()
       await waitForCache(100)
   })
   ```

3. **Check allKeys usage**: Use `cache.allKeys.has(key)` instead of `stats.length`
   - PM2 cluster sync has 5-second delay for stats
   - `allKeys` is immediately updated

4. **Verify hit rate format**: Should return "X.XX%" format
   ```javascript
   expect(stats.hitRate).toMatch(/^\d+\.\d{2}%$/)
   ```

### PM2 Cluster Cache Timing Issues

If tests fail with timing-related issues:

1. **Increase wait times**:
   ```javascript
   await waitForCache(250) // Instead of 100ms
   ```

2. **Use allKeys instead of stats**:
   ```javascript
   // Good - immediate
   expect(cache.allKeys.size).toBeGreaterThanOrEqual(3)
   
   // Avoid - has 5s delay
   // expect(stats.length).toBe(3)
   ```

3. **Wait after clear()**:
   ```javascript
   await cache.clear()
   await waitForCache(100) // Let PM2 sync
   ```

### Jest Warnings

The "Jest did not exit one second after the test run has completed" warning is **expected and normal**:
- PM2 Cluster Cache keeps background processes running
- Tests complete successfully despite this warning
- Warning mentioned in project's Copilot instructions as known behavior

---

## Integration with CI/CD

These tests run automatically in GitHub Actions:

```yaml
# In .github/workflows/test.yml
- name: Run cache tests
  run: npm run runtest -- cache/__tests__/
```

**Expected CI Behavior**:
- ✅ 90 tests should pass (69 + 23)
- ⚠️ "Jest did not exit" warning is normal
- ⏱️ Takes ~27 seconds (PM2 cluster timing)

---

## Performance Characteristics

### cache.test.js
- **Time**: ~18 seconds
- **Reason**: PM2 cluster synchronization delays
- **Optimization**: Uses `await waitForCache()` for reliability

### cache-limits.test.js
- **Time**: ~9 seconds
- **Reason**: TTL expiration tests (1-2 second waits)
- **Optimization**: Uses short TTLs (500-1000ms) instead of default 24 hours

### Total Test Suite
- **Time**: ~27 seconds
- **Tests**: 90
- **Average**: ~300ms per test
- **Bottleneck**: PM2 cluster cache synchronization timing

---

## Coverage Notes

### What's Tested ✅
- ✅ All 8 read endpoint middleware functions (query, search, searchPhrase, id, history, since, gog-fragments, gog-glosses)
- ✅ Cache invalidation logic for 40 scenarios (MongoDB operators, nested properties, selective invalidation)
- ✅ PM2 Cluster Cache limit configuration (TTL, maxLength, maxBytes)
- ✅ Cache hit/miss detection and X-Cache headers
- ✅ Statistics tracking (hits, misses, hit rate, evictions)
- ✅ Breaking change detection (properties removed, PM2 unavailable, defaults changed)

### What's NOT Tested ❌
- ❌ Real MongoDB integration (CREATE/UPDATE with actual database)
- ❌ Version chain invalidation with real RERUM `__rerum` metadata
- ❌ Long TTL expiration (24 hours - would slow tests)
- ❌ Multi-worker PM2 cluster under load
- ❌ Large-scale stress testing (10,000+ entries, 1GB data)
- ❌ Response interceptor timing with real Express stack

**Recommendation**: Use these unit tests for development, use integration tests (with real server/database) for deployment validation.

---

## Maintenance

### When to Update Tests

Update tests when:
- ✅ Adding new cached endpoints → Add middleware tests to cache.test.js
- ✅ Changing cache key generation → Update key validation tests
- ✅ Modifying invalidation logic → Update invalidation tests
- ✅ Adding new limits → Add configuration tests to cache-limits.test.js
- ✅ Changing PM2 configuration → Update PM2-specific tests
- ✅ Modifying stats structure → Update stats reporting tests

### Test Review Checklist

Before merging cache changes:
- [ ] All 90 tests passing (69 middleware + 23 limits)
- [ ] New endpoints have corresponding middleware tests
- [ ] New limits have configuration tests
- [ ] Invalidation logic tested for new scenarios
- [ ] Breaking change detection updated
- [ ] Documentation updated (TESTS.md, ARCHITECTURE.md)
- [ ] Manual testing completed with real server

---

## Related Documentation

- `cache/docs/ARCHITECTURE.md` - PM2 Cluster Cache architecture and design
- `cache/docs/DETAILED.md` - Complete implementation details
- `cache/docs/SHORT.md` - Quick reference guide
- `cache/docs/CACHE_METRICS_REPORT.md` - Production performance metrics

---

**Test Coverage Summary**:
- **cache.test.js**: 69 tests (middleware + invalidation)
- **cache-limits.test.js**: 23 tests (TTL + maxLength + maxBytes)
- **Total**: 92 tests, 90 passing ✅ (2 GOG tests skipped in some environments)
- **Time**: ~27 seconds
- **Last Updated**: October 30, 2025
