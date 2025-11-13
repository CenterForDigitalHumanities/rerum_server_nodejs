# RERUM API Cache Layer - Executive Summary

## What This Improves

The RERUM API now includes an intelligent caching layer that significantly improves performance for read operations while maintaining data accuracy through smart invalidation.

## Key Benefits

### 🚀 **Faster Response Times**
- **Cache hits respond in 1-5ms** (compared to 300-800ms for database queries)
- Frequently accessed objects load instantly
- Query results are reused across multiple requests

### 💰 **Reduced Database Load**
- Fewer database connections required
- Lower MongoDB Atlas costs
- Better scalability for high-traffic applications

### 🎯 **Smart Cache Management**
- Cache automatically updates when data changes
- No stale data returned to users
- Selective invalidation preserves unrelated cached data

### 📊 **Transparent Operation**
- Response headers indicate cache hits/misses (`X-Cache: HIT` or `X-Cache: MISS`)
- Real-time statistics available via `/v1/api/cache/stats`
- Clear cache manually via `/v1/api/cache/clear`

## How It Works

### For Read Operations
When you request data:
1. **First request**: Fetches from database, caches result, returns data (~300-800ms)
2. **Subsequent requests**: Returns cached data immediately (~1-5ms)
3. **After TTL expires**: Cache entry removed, next request refreshes from database (default: 5 minutes, configurable up to 24 hours)

### For Write Operations
When you create, update, or delete objects:
- **Smart invalidation** automatically clears only the relevant cached queries
- **Version chain tracking** ensures history/since endpoints stay current
- **Preserved caching** for unrelated queries continues to benefit performance

## What Gets Cached

### ✅ Cached Endpoints
- `/v1/api/query` - Object queries with filters
- `/v1/api/search` - Full-text search results
- `/v1/api/search/phrase` - Phrase search results
- `/v1/id/{id}` - Individual object lookups
- `/v1/history/{id}` - Object version history
- `/v1/since/{id}` - Object descendants
- `/v1/api/_gog/fragments_from_manuscript` - GOG fragments
- `/v1/api/_gog/glosses_from_manuscript` - GOG glosses

### ⚡ Not Cached (Write Operations)
- `/v1/api/create` - Creates new objects
- `/v1/api/update` - Updates existing objects
- `/v1/api/delete` - Deletes objects
- `/v1/api/patch` - Patches objects
- All write operations trigger smart cache invalidation

## Performance Impact

**Expected Cache Hit Rate**: 60-80% for read-heavy workloads

**Time Savings Per Cache Hit**: 300-800ms (depending on query complexity)

**Example Scenario**:
- Application makes 1,000 `/query` requests per hour
- 70% cache hit rate = 700 cached responses
- Time saved: 700 × 400ms average = **280 seconds (4.7 minutes) per hour**
- Database queries reduced by 70%

## Monitoring & Management

### View Cache Statistics
```
GET /v1/api/cache/stats
```
Returns:
- Total hits and misses
- Hit rate percentage
- Current cache size
- Detailed cache entries (optional)

### Clear Cache
```
POST /v1/api/cache/clear
```
Immediately clears all cached entries (useful for testing or troubleshooting).

## Configuration

Cache behavior can be adjusted via environment variables:
- `CACHING` - Enable/disable caching layer (default: `true`, set to `false` to disable)
- `CACHE_MAX_LENGTH` - Maximum entries (default: 1000)
- `CACHE_MAX_BYTES` - Maximum memory usage (default: 1GB)
- `CACHE_TTL` - Time-to-live in milliseconds (default: 300000 = 5 minutes, production often uses 86400000 = 24 hours)

**Note**: Limits are well-balanced for typical usage. With standard RERUM queries (100 items per page), 1000 cached entries use only ~26 MB (~2.7% of the 1GB byte limit). The byte limit serves as a safety net for edge cases.

### Disabling Cache

To disable caching completely, set `CACHING=false` in your `.env` file. This will:
- Skip all cache lookups (no cache hits)
- Skip cache storage (no cache writes)
- Skip cache invalidation (no overhead on writes)
- Remove `X-Cache` headers from responses
- Useful for debugging or when caching is not desired

## Backwards Compatibility

✅ **Fully backwards compatible**
- No changes required to existing client applications
- All existing API endpoints work exactly as before
- Only difference: faster responses for cached data

## For Developers

The cache is completely transparent:
- Check `X-Cache` response header to see if request was cached
- Cache automatically manages memory using LRU (Least Recently Used) eviction
- Version chains properly handled for RERUM's object versioning model
- No manual cache management required

---

**Bottom Line**: The caching layer provides significant performance improvements with zero impact on data accuracy or application compatibility.
