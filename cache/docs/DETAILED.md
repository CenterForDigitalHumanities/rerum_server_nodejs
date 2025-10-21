# RERUM API Cache Layer - Technical Details

## Overview

The RERUM API implements an LRU (Least Recently Used) cache with smart invalidation for all read endpoints. The cache intercepts requests before they reach the database and automatically invalidates when data changes.

## Cache Configuration

### Default Settings
- **Max Length**: 1000 entries
- **Max Bytes**: 1GB (1,000,000,000 bytes)
- **TTL (Time-To-Live)**: 5 minutes (300,000ms)
- **Eviction Policy**: LRU (Least Recently Used)
- **Storage**: In-memory (per server instance)

### Environment Variables
```bash
CACHE_MAX_LENGTH=1000        # Maximum number of cached entries
CACHE_MAX_BYTES=1000000000   # Maximum memory usage in bytes
CACHE_TTL=300000             # Time-to-live in milliseconds
```

### Limit Enforcement Details

The cache implements **dual limits** for defense-in-depth:

1. **Length Limit (1000 entries)**
   - Primary working limit
   - Ensures diverse cache coverage
   - Prevents cache thrashing from too many unique queries
   - Reached first under normal operation

2. **Byte Limit (1GB)**
   - Secondary safety limit
   - Prevents memory exhaustion
   - Protects against accidentally large result sets
   - Guards against malicious queries

**Balance Analysis**: With typical RERUM queries (100 items per page at ~269 bytes per annotation):
- 1000 entries = ~26 MB (2.7% of 1GB limit)
- Length limit reached first in 99%+ of scenarios
- Byte limit only activates for edge cases (e.g., entries > 1MB each)

**Eviction Behavior**:
- When length limit exceeded: Remove least recently used entry
- When byte limit exceeded: Remove LRU entries until under limit
- Both limits checked on every cache write operation

**Byte Size Calculation**:
```javascript
// Accurately calculates total cache memory usage
calculateByteSize() {
    let totalBytes = 0
    for (const [key, node] of this.cache.entries()) {
        totalBytes += Buffer.byteLength(key, 'utf8')
        totalBytes += Buffer.byteLength(JSON.stringify(node.value), 'utf8')
    }
    return totalBytes
}
```

This ensures the byte limit is properly enforced (fixed in PR #225).

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

Returns cache performance metrics:
```json
{
  "hits": 1234,
  "misses": 456,
  "hitRate": "73.02%",
  "evictions": 12,
  "sets": 1801,
  "invalidations": 89,
  "length": 234,
  "bytes": 2457600,
  "lifespan": "5 minutes 32 seconds",
  "maxLength": 1000,
  "maxBytes": 1000000000,
  "ttl": 300000
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
  "invalidations": 89,
  "length": 234,
  "bytes": 2457600,
  "lifespan": "5 minutes 32 seconds",
  "maxLength": 1000,
  "maxBytes": 1000000000,
  "ttl": 300000,
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

### Cache Clear (`POST /v1/api/cache/clear`)
**Handler**: `cacheClear`

Clears all cache entries:
```json
{
  "message": "Cache cleared",
  "entriesCleared": 234,
  "currentSize": 0
}
```

---

## Smart Invalidation

### How It Works

When write operations occur, the cache middleware intercepts the response and invalidates relevant cache entries based on the object properties.

### CREATE Invalidation

**Triggers**: `POST /v1/api/create`

**Invalidates**:
- All `query` caches where the new object matches the query filters
- All `search` caches where the new object contains search terms
- All `searchPhrase` caches where the new object contains the phrase

**Example**:
```javascript
// CREATE object with type="Annotation"
// Invalidates: query:{"type":"Annotation",...}
// Preserves:   query:{"type":"Person",...}
```

### UPDATE Invalidation

**Triggers**: `PUT /v1/api/update`, `PATCH /v1/api/patch/*`

**Invalidates**:
- The `id` cache for the updated object
- All `query` caches matching the updated object's properties
- All `search` caches matching the updated object's content
- The `history` cache for all versions in the chain
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

**Triggers**: `PATCH /v1/api/patch/set`, `PATCH /v1/api/patch/unset`, `PATCH /v1/api/patch/update`

**Behavior**: Same as UPDATE invalidation (creates new version)

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

**Critical Fix**: History and since keys do NOT use `JSON.stringify()`, avoiding quote characters in the key that would prevent pattern matching during invalidation.

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
Request → Cache Middleware → Cache Lookup → Return Cached Data
Total Time: 1-5ms
```

### Cache Miss (First Request)
```
Request → Cache Middleware → Controller → MongoDB → Cache Store → Response
Total Time: 300-800ms (depending on query complexity)
```

### Memory Usage
- Average entry size: ~2-10KB (depending on object complexity)
- Max memory (1000 entries): ~2-10MB
- LRU eviction ensures memory stays bounded

### TTL Behavior
- Entry created: Timestamp recorded
- Entry accessed: Timestamp NOT updated (read-through cache)
- After 5 minutes: Entry expires and is evicted
- Next request: Cache miss, fresh data fetched

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
- Multiple simultaneous cache misses for same key
- Each request queries database independently
- First to complete populates cache for others

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

### Thread Safety
- JavaScript is single-threaded, no locking required
- Map operations are atomic within event loop

### Memory Management
- LRU eviction prevents unbounded growth
- Configurable max size via environment variable
- Automatic TTL expiration

### Extensibility
- New endpoints can easily add cache middleware
- Smart invalidation uses object property matching
- GOG endpoints demonstrate custom cache key generation

---

## Future Enhancements

Possible improvements (not currently implemented):
- Redis/Memcached for multi-server caching
- Warming cache on server startup
- Adaptive TTL based on access patterns
- Cache compression for large objects
- Metrics export (Prometheus, etc.)
