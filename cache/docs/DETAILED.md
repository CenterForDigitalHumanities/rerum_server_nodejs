# RERUM API Cache Layer - Technical Details

## Overview

The RERUM API implements a **PM2 Cluster Cache** with smart invalidation for all read endpoints. The cache uses `pm2-cluster-cache` to synchronize cached data across all worker instances in PM2 cluster mode, ensuring consistent cache hits regardless of which worker handles the request.

## Prerequisites

### Required System Tools

The cache test scripts require the following command-line tools:

#### Essential Tools (must install)
- **`jq`** - JSON parser for extracting fields from API responses
- **`bc`** - Calculator for arithmetic operations in metrics
- **`curl`** - HTTP client for API requests

**Quick Install (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y jq bc curl
```

**Quick Install (macOS with Homebrew):**
```bash
brew install jq bc curl
```

#### Standard Unix Tools (usually pre-installed)
- `date` - Timestamp operations
- `sed` - Text manipulation
- `awk` - Text processing
- `grep` - Pattern matching
- `cut` - Text field extraction
- `sort` - Sorting operations
- `head` / `tail` - Line operations

These are typically pre-installed on Linux/macOS systems. If missing, install via your package manager.

## Cache Configuration

### Default Settings
- **Enabled by default**: Set `CACHING=false` to disable
- **Max Length**: 1000 entries per worker (configurable)
- **Max Bytes**: 1GB per worker (1,000,000,000 bytes) (configurable)
- **TTL (Time-To-Live)**: 24 hours default (86,400,000ms)
- **Storage Mode**: PM2 Cluster Cache with 'all' replication mode (full cache copy on each worker, synchronized automatically)
- **Stats Tracking**: Atomic counters for sets/evictions (race-condition free), local counters for hits/misses (synced every 5 seconds)
- **Eviction**: LRU (Least Recently Used) eviction implemented with deferred background execution via setImmediate() to avoid blocking cache.set() operations

### Environment Variables
```bash
CACHING=true                 # Enable/disable caching layer (true/false)
CACHE_MAX_LENGTH=1000        # Maximum number of cached entries
CACHE_MAX_BYTES=1000000000   # Maximum memory usage in bytes (per worker)
CACHE_TTL=86400000           # Time-to-live in milliseconds (default: 86400000 = 24 hours)
```

### Enabling/Disabling Cache

**To disable caching completely**, set `CACHING=false` in your `.env` file:
- All cache middleware will be bypassed
- No cache lookups, storage, or invalidation
- No `X-Cache` headers in responses
- No overhead from cache operations
- Useful for debugging or performance comparison

**To enable caching** (default), set `CACHING=true` or leave it unset.

### Limit Enforcement Details

The cache implements **dual limits** for defense-in-depth:

1. **Length Limit (1000 entries)**
   - Primary working limit
   - Ensures diverse cache coverage
   - Prevents cache thrashing from too many unique queries
   - Reached first under normal operation
   - LRU eviction triggered when exceeded (evicts least recently accessed entry)
   - Eviction deferred to background via setImmediate() to avoid blocking cache.set()

2. **Byte Limit (1GB)**
   - Secondary safety limit
   - Prevents memory exhaustion
   - Protects against accidentally large result sets
   - Guards against malicious queries
   - LRU eviction triggered when exceeded
   - Eviction runs in background to avoid blocking operations

**Balance Analysis**: With typical RERUM queries (100 items per page at ~269 bytes per annotation):
- 1000 entries = ~26 MB (2.7% of 1GB limit)
- Length limit reached first in 99%+ of scenarios
- Byte limit only relevant for monitoring and capacity planning

**Eviction Behavior**:
- **LRU (Least Recently Used)** eviction strategy implemented in cache/index.js
- Eviction triggered when maxLength (1000) or maxBytes (1GB) exceeded
- Eviction deferred to background using setImmediate() to avoid blocking cache.set()
- Synchronized across all workers via PM2 cluster-cache
- Tracks access times via keyAccessTimes Map for LRU determination

**Byte Size Calculation** (for monitoring only):
```javascript
// Used for stats reporting, not enforced by pm2-cluster-cache
calculateByteSize() {
    let totalBytes = 0
    for (const [key, value] of this.cache.entries()) {
        totalBytes += Buffer.byteLength(key, 'utf8')
        totalBytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
    }
    return totalBytes
}
```

This provides visibility into memory usage across workers.

## Cached Endpoints

### 1. Query Endpoint (`POST /v1/api/query`)
**Middleware**: `cacheQuery`

**Cache Key Format**: `query:{JSON}`
- Includes request body (query filters)
- Includes pagination parameters (limit, skip)

**Example**:
```
Request: POST /v1/api/query
Body: { "type": "Annotation", "creator": "user123" }
Query: ?limit=100&skip=0

Cache Key: query:{"body":{"type":"Annotation","creator":"user123"},"limit":"100","skip":"0"}
```

**Invalidation**: When CREATE, UPDATE, PATCH, or DELETE operations affect objects matching the query filters.

---

### 2. Search Endpoint (`POST /v1/api/search`)
**Middleware**: `cacheSearch`

**Cache Key Format**: `search:{JSON}`
- Serializes search text or search object

**Example**:
```
Request: POST /v1/api/search
Body: "manuscript"

Cache Key: search:"manuscript"
```

**Invalidation**: When CREATE, UPDATE, PATCH, or DELETE operations modify objects containing the search terms.

---

### 3. Search Phrase Endpoint (`POST /v1/api/search/phrase`)
**Middleware**: `cacheSearchPhrase`

**Cache Key Format**: `searchPhrase:{JSON}`
- Serializes exact phrase to search

**Example**:
```
Request: POST /v1/api/search/phrase
Body: "medieval manuscript"

Cache Key: searchPhrase:"medieval manuscript"
```

**Invalidation**: When CREATE, UPDATE, PATCH, or DELETE operations modify objects containing the phrase.

---

### 4. ID Lookup Endpoint (`GET /v1/id/{id}`)
**Middleware**: `cacheId`

**Cache Key Format**: `id:{id}`
- Direct object ID lookup

**Example**:
```
Request: GET /v1/id/507f1f77bcf86cd799439011

Cache Key: id:507f1f77bcf86cd799439011
```

**Special Headers**:
- `Cache-Control: max-age=86400, must-revalidate` (24 hours)
- `X-Cache: HIT` or `X-Cache: MISS`

**Invalidation**: When UPDATE, PATCH, or DELETE operations affect this specific object.

---

### 5. History Endpoint (`GET /v1/history/{id}`)
**Middleware**: `cacheHistory`

**Cache Key Format**: `history:{id}`
- Returns version history for an object

**Example**:
```
Request: GET /v1/history/507f1f77bcf86cd799439011

Cache Key: history:507f1f77bcf86cd799439011
```

**Invalidation**: When UPDATE operations create new versions in the object's version chain. Invalidates cache for:
- The new version ID
- The previous version ID (`__rerum.history.previous`)
- The root version ID (`__rerum.history.prime`)

**Note**: DELETE operations invalidate all history caches in the version chain.

---

### 6. Since Endpoint (`GET /v1/since/{id}`)
**Middleware**: `cacheSince`

**Cache Key Format**: `since:{id}`
- Returns all descendant versions since a given object

**Example**:
```
Request: GET /v1/since/507f1f77bcf86cd799439011

Cache Key: since:507f1f77bcf86cd799439011
```

**Invalidation**: When UPDATE operations create new descendants. Invalidates cache for:
- The new version ID
- All predecessor IDs in the version chain
- The root/prime ID

**Critical for RERUM Versioning**: Since queries use the root object ID, but updates create new object IDs, the invalidation logic extracts and invalidates all IDs in the version chain.

---

### 7. GOG Fragments Endpoint (`POST /v1/api/_gog/fragments_from_manuscript`)
**Middleware**: `cacheGogFragments`

**Cache Key Format**: `gogFragments:{manuscriptURI}:{limit}:{skip}`

**Validation**: Requires valid `ManuscriptWitness` URI in request body

**Example**:
```
Request: POST /v1/api/_gog/fragments_from_manuscript
Body: { "ManuscriptWitness": "https://example.org/manuscript/123" }
Query: ?limit=50&skip=0

Cache Key: gogFragments:https://example.org/manuscript/123:50:0
```

**Invalidation**: When CREATE, UPDATE, or DELETE operations affect fragments for this manuscript.

---

### 8. GOG Glosses Endpoint (`POST /v1/api/_gog/glosses_from_manuscript`)
**Middleware**: `cacheGogGlosses`

**Cache Key Format**: `gogGlosses:{manuscriptURI}:{limit}:{skip}`

**Validation**: Requires valid `ManuscriptWitness` URI in request body

**Example**:
```
Request: POST /v1/api/_gog/glosses_from_manuscript
Body: { "ManuscriptWitness": "https://example.org/manuscript/123" }
Query: ?limit=50&skip=0

Cache Key: gogGlosses:https://example.org/manuscript/123:50:0
```

**Invalidation**: When CREATE, UPDATE, or DELETE operations affect glosses for this manuscript.

---

## Cache Management Endpoints

### Cache Statistics (`GET /v1/api/cache/stats`)
**Handler**: `cacheStats`

**Stats Tracking**: 
- **Atomic counters** (sets, evictions): Updated immediately in cluster cache to prevent race conditions
- **Local counters** (hits, misses): Tracked locally per worker, synced to cluster cache every 5 seconds for performance
- **Aggregation**: Stats endpoint aggregates from all workers, accurate within 5 seconds for hits/misses

Returns cache performance metrics:
```json
{
  "hits": 1234,
  "misses": 456,
  "hitRate": "73.02%",
  "evictions": 12,
  "sets": 1801,
  "length": 234,
  "bytes": 2457600,
  "lifespan": "5 minutes 32 seconds",
  "maxLength": 1000,
  "maxBytes": 1000000000,
  "ttl": 86400000
}
```

**With Details** (`?details=true`):
```json
{
  "hits": 1234,
  "misses": 456,
  "hitRate": "73.02%",
  "evictions": 12,
  "sets": 1801,
  "length": 234,
  "bytes": 2457600,
  "lifespan": "5 minutes 32 seconds",
  "maxLength": 1000,
  "maxBytes": 1000000000,
  "ttl": 86400000,
  "details": [
    {
      "position": 0,
      "key": "id:507f1f77bcf86cd799439011",
      "age": "2 minutes 15 seconds",
      "hits": 45,
      "length": 183,
      "bytes": 183
    },
    {
      "position": 1,
      "key": "query:{\"type\":\"Annotation\"}",
      "age": "5 minutes 2 seconds",
      "hits": 12,
      "length": 27000,
      "bytes": 27000
    }
  ]
}
```
---

## Smart Invalidation

### How It Works

When write operations occur, the cache middleware intercepts the response and invalidates relevant cache entries based on the object properties.

**MongoDB Operator Support**: The smart invalidation system supports complex MongoDB query operators, including:
- **`$or`** - Matches if ANY condition is satisfied (e.g., queries checking multiple target variations)
- **`$and`** - Matches if ALL conditions are satisfied
- **`$exists`** - Field existence checking
- **`$size`** - Array size matching (e.g., `{"__rerum.history.next": {"$exists": true, "$size": 0}}` for leaf objects)
- **Comparison operators** - `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- **`$in`** - Value in array matching
- **Nested properties** - Dot notation like `target.@id`, `body.title.value`

**Protected Properties**: The system intelligently skips `__rerum` and `_id` fields during cache matching, as these are server-managed properties not present in user request bodies. This includes:
- Top-level: `__rerum`, `_id`
- Nested paths: `__rerum.history.next`, `target._id`, etc.
- Any position: starts with, contains, or ends with these protected property names

This conservative approach ensures cache invalidation is based only on user-controllable properties, preventing false negatives while maintaining correctness.

**Example with MongoDB Operators**:
```javascript
// Complex query with $or operator (common in Annotation queries)
{
  "body": {
    "$or": [
      {"target": "https://example.org/canvas/1"},
      {"target.@id": "https://example.org/canvas/1"}
    ]
  },
  "__rerum.history.next": {"$exists": true, "$size": 0}  // Skipped (protected)
}

// When an Annotation is updated with target="https://example.org/canvas/1",
// the cache system:
// 1. Evaluates the $or operator against the updated object
// 2. Skips the __rerum.history.next check (server-managed)
// 3. Invalidates this cache entry if the $or condition matches
```

### CREATE Invalidation

**Triggers**: `POST /v1/api/create`, `POST /v1/api/bulkCreate`

**Invalidates**:
- All `query` caches where the new object matches the query filters (with MongoDB operator support)
- All `search` caches where the new object contains search terms
- All `searchPhrase` caches where the new object contains the phrase

**Example**:
```javascript
// CREATE object with type="Annotation"
// Invalidates: query:{"type":"Annotation",...}
// Preserves:   query:{"type":"Person",...}
```

### UPDATE Invalidation

**Triggers**: `PUT /v1/api/update`, `PUT /v1/api/bulkUpdate`, `PATCH /v1/api/patch`, `PATCH /v1/api/set`, `PATCH /v1/api/unset`, `PUT /v1/api/overwrite`

**Invalidates**:
- The `id` cache for the updated object (and previous version in chain)
- All `query` caches matching the updated object's properties (with MongoDB operator support)
- All `search` caches matching the updated object's content
- The `history` cache for all versions in the chain (current, previous, prime)
- The `since` cache for all versions in the chain

**Version Chain Logic**:
```javascript
// Updated object structure:
{
  "@id": "http://localhost:3001/v1/id/68f68786...", // NEW ID
  "__rerum": {
    "history": {
      "previous": "http://localhost:3001/v1/id/68f68783...",
      "prime": "http://localhost:3001/v1/id/68f6877f..."
    }
  }
}

// Invalidates history/since for ALL three IDs:
// - 68f68786 (current)
// - 68f68783 (previous)
// - 68f6877f (prime/root)
```

### DELETE Invalidation

**Triggers**: `DELETE /v1/api/delete/{id}`

**Invalidates**:
- The `id` cache for the deleted object
- All `query` caches matching the deleted object (before deletion)
- All `search` caches matching the deleted object
- The `history` cache for all versions in the chain
- The `since` cache for all versions in the chain

**Special Handling**: Uses `res.locals.deletedObject` to access object properties before deletion occurs.

### PATCH Invalidation

**Triggers**: 
- `PATCH /v1/api/patch` - General property updates
- `PATCH /v1/api/set` - Add new properties
- `PATCH /v1/api/unset` - Remove properties

**Behavior**: Same as UPDATE invalidation (creates new version with MongoDB operator support)

**Note**: `PATCH /v1/api/release` does NOT use cache invalidation as it only modifies `__rerum` properties which are skipped during cache matching.

### OVERWRITE Invalidation

**Triggers**: `PUT /v1/api/overwrite`

**Behavior**: Similar to UPDATE but replaces entire object in place (same ID)

**Invalidates**:
- The `id` cache for the overwritten object
- All `query` caches matching the new object properties
- All `search` caches matching the new object content
- The `history` cache for all versions in the chain
- The `since` cache for all versions in the chain

---

## Write Endpoints with Smart Invalidation

All write operations that modify user-controllable properties have the `invalidateCache` middleware applied:

| Endpoint | Method | Middleware Applied | Invalidation Type |
|----------|--------|-------------------|-------------------|
| `/v1/api/create` | POST | ✅ `invalidateCache` | CREATE |
| `/v1/api/bulkCreate` | POST | ✅ `invalidateCache` | CREATE (bulk) |
| `/v1/api/update` | PUT | ✅ `invalidateCache` | UPDATE |
| `/v1/api/bulkUpdate` | PUT | ✅ `invalidateCache` | UPDATE (bulk) |
| `/v1/api/patch` | PATCH | ✅ `invalidateCache` | UPDATE |
| `/v1/api/set` | PATCH | ✅ `invalidateCache` | UPDATE |
| `/v1/api/unset` | PATCH | ✅ `invalidateCache` | UPDATE |
| `/v1/api/overwrite` | PUT | ✅ `invalidateCache` | OVERWRITE |
| `/v1/api/delete` | DELETE | ✅ `invalidateCache` | DELETE |

**Not Requiring Invalidation**:
- `/v1/api/release` (PATCH) - Only modifies `__rerum` properties (server-managed, skipped in cache matching)

**Key Features**:
- MongoDB operator support (`$or`, `$and`, `$exists`, `$size`, comparisons, `$in`)
- Nested property matching (dot notation like `target.@id`)
- Protected property handling (skips `__rerum` and `_id` fields)
- Version chain invalidation for UPDATE/DELETE operations
- Bulk operation support (processes multiple objects)

---

## Cache Key Generation

### Simple Keys (ID, History, Since)
```javascript
generateKey('id', '507f1f77bcf86cd799439011')
// Returns: "id:507f1f77bcf86cd799439011"

generateKey('history', '507f1f77bcf86cd799439011')
// Returns: "history:507f1f77bcf86cd799439011"

generateKey('since', '507f1f77bcf86cd799439011')
// Returns: "since:507f1f77bcf86cd799439011"
```

### Complex Keys (Query, Search)
```javascript
generateKey('query', { type: 'Annotation', limit: '100', skip: '0' })
// Returns: "query:{"limit":"100","skip":"0","type":"Annotation"}"
// Note: Properties are alphabetically sorted for consistency
```

**Consistent Serialization**: All cache keys use `JSON.stringify()` for the data portion, ensuring consistent matching during invalidation pattern searches.

---

## Response Headers

### X-Cache Header
- `X-Cache: HIT` - Response served from cache
- `X-Cache: MISS` - Response fetched from database and cached

### Cache-Control Header (ID endpoint only)
- `Cache-Control: max-age=86400, must-revalidate`
- Suggests browsers can cache for 24 hours but must revalidate

---

## Performance Characteristics

### Cache Hit (Typical)
```
Request → Cache Middleware → PM2 Cluster Cache Lookup → Return Cached Data
Total Time: 1-5ms (local worker cache, no network overhead)
```

### Cache Miss (First Request)
```
Request → Cache Middleware → Controller → MongoDB → PM2 Cluster Cache Store (synchronized to all workers) → Response
Total Time: 300-800ms (depending on query complexity)
```

### Memory Usage
- Average entry size: ~2-10KB (depending on object complexity)
- Max memory per worker (1000 entries × ~10KB): ~10MB
- LRU eviction ensures memory stays bounded (deferred to background via setImmediate())
- All workers maintain identical cache state (storage mode: 'all')

### TTL Behavior
- Entry created: Stored with TTL metadata (5 min default, 24 hr in production)
- Entry accessed: TTL countdown continues (read-through cache)
- After TTL expires: pm2-cluster-cache automatically removes entry across all workers
- Next request: Cache miss, fresh data fetched and cached

---

## Edge Cases & Considerations

### 1. Version Chains
RERUM's versioning model creates challenges:
- Updates create NEW object IDs
- History/since queries use root/original IDs
- Solution: Extract and invalidate ALL IDs in version chain

### 2. Pagination
- Different pagination parameters create different cache keys
- `?limit=10` and `?limit=20` are cached separately
- Ensures correct page size is returned

### 3. Non-200 Responses
- Only 200 OK responses are cached
- 404, 500, etc. are NOT cached
- Prevents caching of error states

### 4. Concurrent Requests
- Multiple simultaneous cache misses for same key across different workers
- Each worker queries database independently
- PM2 Cluster Cache synchronizes result to all workers after first completion
- Subsequent requests hit cache on their respective workers

### 5. Case Sensitivity
- Cache keys are case-sensitive
- `{"type":"Annotation"}` ≠ `{"type":"annotation"}`
- Query normalization handled by controller layer

---

## Monitoring & Debugging

### Check Cache Performance
```bash
curl http://localhost:3001/v1/api/cache/stats?details=true
```

### Verify Cache Hit/Miss
```bash
curl -I http://localhost:3001/v1/id/507f1f77bcf86cd799439011
# Look for: X-Cache: HIT or X-Cache: MISS
```

### Clear Cache During Development
```bash
curl -X POST http://localhost:3001/v1/api/cache/clear
```

### View Logs
Cache operations are logged with `[CACHE]` prefix:
```
[CACHE] Cache HIT: id 507f1f77bcf86cd799439011
[CACHE INVALIDATE] Invalidated 5 cache entries (2 history/since)
```

---

## Implementation Notes

### PM2 Cluster Mode
- Uses pm2-cluster-cache v2.1.7 with storage mode 'all' (full replication)
- All workers maintain identical cache state
- Cache writes synchronized automatically across workers
- No shared memory or IPC overhead (each worker has independent Map)

### Memory Management
- LRU eviction implemented in cache/index.js with deferred background execution (setImmediate())
- Eviction triggered when maxLength or maxBytes exceeded
- Evictions synchronized across all workers via PM2 cluster-cache
- Byte size calculated using optimized _calculateSize() method (fast path for primitives)

### Extensibility
- New endpoints can easily add cache middleware
- Smart invalidation uses object property matching
- GOG endpoints demonstrate custom cache key generation

---

## Future Enhancements

Possible improvements (not currently implemented):
- Warming cache on server startup
- Adaptive TTL based on access patterns
- Cache compression for large objects
- Metrics export (Prometheus, etc.)
