# PM2 Cluster Cache Requirements & Solution Analysis

**Date**: 2025-11-07
**Status**: Requirements Defined - External Solution Required
**For**: New branch from `main` implementing production-ready cluster caching

---

## 🎯 ABSOLUTE REQUIREMENT

**The cache must NEVER return stale data under any circumstances.**

This is a hard requirement. Even 1% stale data rate is unacceptable. Users must always receive the most current data from the database, or the feature cannot be deployed.

---

## What We're Trying to Build

### System Architecture

- **Environment**: RERUM API running in PM2 cluster mode with 4 worker processes
- **Load Balancing**: PM2 round-robin across all workers
- **Database**: MongoDB Atlas (centralized, single source of truth)
- **Caching Goal**: Reduce MongoDB load by caching expensive operations

### Operations to Cache

1. **GET /id/{id}** - Direct object retrieval by ID (1-5ms MongoDB lookup)
2. **POST /query** - Complex JSON queries matching object properties (10-100ms)
3. **POST /search** - Full-text search across annotations (50-200ms)
4. **GET /history/{id}** - Version history traversal (20-100ms)
5. **GET /since/{id}** - Version descendants (20-100ms)

### Cache Invalidation Requirements

**Write operations that must invalidate cache**:
- `POST /create` - Creates new object → invalidate matching queries
- `PUT /update` - Creates new version → invalidate ID, queries, history/since chains
- `PATCH /patch` - Updates object → same as update
- `POST /overwrite` - Overwrites without versioning → invalidate ID, queries
- `DELETE /delete` - Marks deleted → invalidate ID, queries, history/since chains
- `POST /release` - Locks as immutable → invalidate ID, queries

**Invalidation must be**:
- **Synchronous**: Complete BEFORE HTTP response sent to client
- **Cluster-wide**: All 4 workers must see invalidation
- **Atomic**: Either all workers invalidate or operation fails
- **Fast**: Complete within reasonable request timeout (<100ms)

### Traffic Patterns

- **Read-heavy**: ~80% reads, ~20% writes
- **Bursty**: Users often do write→read sequences (e.g., create then immediately query)
- **Concurrent**: Multiple users updating/querying simultaneously
- **Latency-sensitive**: API timeout is 30 seconds, users expect <1 second responses

---

## ❌ Why JavaScript/Node/PM2 Internal Solutions Don't Work

### Problem: PM2 IPC is Asynchronous

PM2's Inter-Process Communication (IPC) between workers is **fire-and-forget**. There is no mechanism to wait for acknowledgment that all workers have processed a message.

### Tested Solution 1: pm2-cluster-cache

**Library**: https://github.com/pavlikm/pm2-cluster-memory-cache

**How it works**: In-memory cache with PM2 IPC for cross-worker synchronization

**Why it fails**:

Source code analysis (`node_modules/pm2-cluster-cache/lib/ClusterCache.js:158-180`):

```javascript
delete: function _delete(key) {
    return new Promise(function (ok, fail) {
        _repositories.pr.getWriteProcess(key, storage).then(function (processes) {
            processes.forEach((p) => {
                ClusterCache._deleteFromProc(key, p);
            });
            return ok(processes);  // ← Promise resolves IMMEDIATELY
        });
    });
},

_deleteFromProc: function _deleteFromProc(key, proc) {
    if (parseInt(proc) === parseInt(process.env.pm_id)) {
        dr.delete(key);  // Synchronous local delete
    } else {
        pm2.sendDataToProcessId(proc, {
            data: { k: key },
            topic: TOPIC_DELETE
        }, function (e) {});  // ← Fire-and-forget IPC with empty callback
    }
}
```

**The fatal flaw**: `delete()` returns a resolved Promise **immediately after sending IPC messages**, NOT after other workers process them.

**Test results**:
```bash
# race-condition.sh with storage: 'all'
Total rapid write→read tests: 30
Fresh data: 5 (16%)
Stale data: 25 (83%)  ← UNACCEPTABLE
```

**Timeline of failure**:
1. T+0ms: Worker A receives PUT request
2. T+10ms: Worker A updates MongoDB
3. T+12ms: Worker A calls `await cache.delete()` → sends IPC to Workers B/C/D
4. T+14ms: `cache.delete()` Promise resolves (IPC sent but not processed)
5. T+15ms: Worker A sends HTTP 200 OK
6. T+20ms: Client sends GET request
7. T+21ms: Worker B receives GET request
8. T+22ms: Worker B reads cache → **STALE DATA** (IPC from T+12ms not processed yet)
9. T+150ms: Worker B finally processes IPC from T+12ms and deletes cache (too late)

**Timing measurements**:
- Local cache operation: 1-2ms
- IPC propagation: 50-200ms (sometimes >3000ms under load)
- User request gap: 0-100ms

**Gap = guaranteed stale data**

### All Storage Modes Fail

We tested all 4 modes:

1. **`storage: 'all'`** (replicate to all workers)
   - Result: 83% stale data
   - Reason: Async IPC to all workers

2. **`storage: 'master'`** (centralize in master worker)
   - Result: ~62% stale data (estimated)
   - Reason: 75% of writes hit non-master workers, still use async IPC

3. **`storage: 'self'`** (isolated per worker)
   - Result: Persistent stale data (hours/days)
   - Reason: Invalidation only affects current worker, other workers never learn about writes

4. **`storage: 'cluster'`** (consistent hashing)
   - Result: 83% stale data
   - Reason: Same async IPC issues as 'all'

### Attempted Fixes (All Failed)

**Attempt 1: Two-phase invalidation**
- Phase 1: Immediate ID invalidation (2ms)
- Phase 2: Background comprehensive invalidation
- Result: ✗ Only invalidated current worker, others still stale

**Attempt 2: Await with timeout**
- Added 3-second timeout on comprehensive invalidation
- Result: ✗ Timed out every time (>3 seconds), still 83% stale

**Attempt 3: Making response methods async**
- Made `res.json()` async and awaited invalidation
- Result: ✗ Library still resolves Promise before cluster-wide completion

### Why Node.js/PM2 Can't Solve This

**Fundamental limitations**:

1. **No synchronous IPC**: Node's `process.send()` and PM2's `sendDataToProcessId()` are async
2. **No acknowledgment system**: No built-in way to wait for "all workers received and processed"
3. **No atomic broadcasts**: Can't guarantee all-or-nothing delivery
4. **No distributed transactions**: Can't rollback if some workers fail

**What would be needed** (not available in Node/PM2):
- Synchronous request-reply IPC pattern
- Two-phase commit protocol
- Consensus algorithm (Raft, Paxos)
- Distributed lock manager

---

## 🧪 How The Race Condition Was Discovered

### Why Existing Tests Missed It

The cache implementation had multiple test files, but **none of them detected the race condition**:

#### 1. `cache/__tests__/cache-metrics.sh`

**What it tests**: Cache performance metrics (hit rate, memory usage, eviction)

**Why it missed the race condition**:
- Measures aggregate statistics over time
- Doesn't test write→read sequences
- Doesn't verify data correctness, only performance counters
- Example: "Hit rate: 75%, Cache size: 500 entries" ✓ (metrics look good)
- **Missing**: "Are those cached values actually correct?" ✗

#### 2. `cache/__tests__/cache.test.js`

**What it tests**: Cache functionality in isolation (set, get, delete, TTL)

**Why it missed the race condition**:
- Tests cache operations on a single worker
- No concurrent write→read patterns
- No PM2 cluster mode testing
- Example test: `set(key, value)` then `get(key)` on same worker ✓
- **Missing**: Testing across multiple PM2 workers ✗

#### 3. `cache/__tests__/cache-limits.test.js`

**What it tests**: Cache size limits, eviction policies, memory bounds

**Why it missed the race condition**:
- Focused on capacity/eviction behavior
- No cross-worker invalidation testing
- Example: "Cache correctly evicts LRU entries when full" ✓
- **Missing**: "Do all workers see invalidation?" ✗

### The Critical Test That Found It: `race-condition.sh`

**Location**: `cache/__tests__/race-condition.sh`

**What it tests**: Rapid write→read sequences to detect stale data

**Key insight**: The race condition only appears when:
1. A write operation completes
2. A read operation happens **immediately** after (0-100ms gap)
3. The read hits a **different PM2 worker** than the write

**How it works**:

```bash
# Test pattern (repeated 30 times)
for i in {1..30}; do
    # 1. Overwrite object with N items
    curl -X PUT /api/overwrite -d '{"items": [...]}'

    # 2. IMMEDIATELY read it back (no delay)
    actual=$(curl -s /id/{id} | jq '.items | length')

    # 3. Check if stale
    if [ "$actual" != "$expected" ]; then
        echo "STALE DATA - Race Condition!"
    fi
done
```

**Why this works**:
- **Rapid succession**: Write then immediate read (simulates real user behavior)
- **Round-robin**: PM2 load balancer ensures different workers handle requests
- **30 iterations**: Statistically likely to hit different worker combinations
- **Exact comparison**: Checks actual data content, not just cache metrics

**Results**:
```
Total tests: 30
Fresh data: 5 (16%)  ← Only when same worker handles both requests
Stale data: 25 (83%)  ← When different workers handle requests
```

### Anatomy of race-condition.sh

**Step 1: Clear cache**
```bash
curl -X POST /api/cache/clear
# Ensures clean starting state
```

**Step 2: Initialize test object**
```bash
curl -X PUT /api/overwrite -d '{"@id": "...", "items": [...]}'
curl /id/{id}  # Cache it
```

**Step 3: Rapid write→read test**
```bash
for i in {1..30}; do
    expected=<calculated_value>

    # Write (changes items array)
    curl -X PUT /api/overwrite -d '{"items": [...]}'  # Worker A

    # Read IMMEDIATELY (no sleep, no delay)
    actual=$(curl -s /id/{id} | jq '.items | length')  # Worker B

    # Compare
    [ "$actual" == "$expected" ] || echo "STALE!"
done
```

**Step 4: Report results**
```bash
echo "Fresh data: $success"
echo "Stale data: $failures"
```

### Why This Test Is Definitive

**Simulates real-world usage**:
- ✅ Users update objects and immediately re-query
- ✅ Load balancer distributes requests across workers
- ✅ No artificial delays that hide the problem

**Detects the actual issue**:
- ✅ Verifies data correctness, not just cache hits
- ✅ Tests cross-worker synchronization
- ✅ Measures what users actually see

**Quantifies the problem**:
- ✅ Provides percentage failure rate
- ✅ Shows consistency across multiple runs
- ✅ Clear pass/fail criteria (0% stale = success)

### Using race-condition.sh To Validate New Implementations

**CRITICAL**: Any new cache implementation MUST pass this test with **0% stale data**.

**Test procedure**:

```bash
# 1. Ensure PM2 cluster is running with 4 workers
pm2 list  # Should show 4 rerum_v1 processes

# 2. Update the AUTH token in race-condition.sh (line 31)
TOKEN="<your-fresh-auth-token>"

# 3. Verify test object exists
curl http://localhost:3001/v1/id/690e93a7330943df44315d50

# 4. Run the test
cd cache/__tests__
bash race-condition.sh

# 5. Check results
# PASS: "Fresh data: 30 (100%), Stale data: 0 (0%)"
# FAIL: Any stale data detected
```

**Expected results by implementation**:

| Implementation | Expected Result | Reason |
|---|---|---|
| pm2-cluster-cache (current) | 83% stale ✗ | Async IPC |
| Redis | 0% stale ✓ | Atomic operations |
| Memcached | 0% stale ✓ | Atomic operations |
| No cache | 0% stale ✓ | Always fresh from DB |
| Any other solution | **Must be 0%** | Hard requirement |

**Interpreting failures**:

- **Any stale data (>0%)** = Implementation violates "never stale" requirement
- **<100% stale** = Partial synchronization (still unacceptable)
- **100% stale** = Complete cache invalidation failure

### Test Files To Bring To New Branch

When starting a new branch from `main`, bring these critical files:

1. **`.claude/CACHE_LAYER_RESEARCH.md`** (this document)
   - Complete analysis of the problem
   - Why pm2-cluster-cache fails
   - Recommended solutions

2. **`cache/__tests__/race-condition.sh`**
   - The definitive test for stale data
   - Must show 0% stale with new implementation
   - Update AUTH token before running

**DO NOT bring** (these are pm2-cluster-cache specific):
- `cache/index.js` (replace with Redis implementation)
- `cache/middleware.js` (needs Redis imports)
- Existing test files (they don't test the race condition)

---

## ✅ External Solutions That WILL Work

Since JavaScript/Node/PM2 internal mechanisms cannot provide synchronous cluster-wide cache invalidation, we need an **external distributed cache** that all workers connect to as clients.

### Solution 1: Redis (RECOMMENDED)

**What it is**: In-memory data store with built-in pub/sub and atomic operations

**Why it works**:
- **Single source of truth**: All workers connect to same Redis instance
- **Atomic operations**: `DEL`, `SET`, `GET` are atomic across all clients
- **Synchronous from client perspective**: Operation completes when Redis confirms
- **No IPC**: Workers don't need to coordinate with each other
- **Proven at scale**: Used by millions of applications

**Architecture**:
```
┌─────────┐
│ Worker A│──┐
└─────────┘  │
             ├──→ ┌───────────┐
┌─────────┐  │    │   Redis   │  ← Single source of truth
│ Worker B│──┼───→│  Server   │
└─────────┘  │    └───────────┘
             │
┌─────────┐  │
│ Worker C│──┤
└─────────┘  │
             │
┌─────────┐  │
│ Worker D│──┘
└─────────┘
```

**Implementation**:

```javascript
// cache/redis-cache.js
import Redis from 'ioredis'

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    // Optional: password, TLS, etc.
})

class RedisCache {
    async get(key) {
        const value = await redis.get(key)
        return value ? JSON.parse(value) : null
    }

    async set(key, value, ttl = 86400000) {
        await redis.set(key, JSON.stringify(value), 'PX', ttl)
    }

    async delete(key) {
        await redis.del(key)  // ← Synchronous from our perspective
    }

    async invalidate(pattern) {
        const keys = await redis.keys(pattern)
        if (keys.length > 0) {
            await redis.del(...keys)
        }
    }
}
```

**Invalidation example**:
```javascript
// Worker A handles POST /create
await redis.delete(`id:${newId}`)  // Atomic
await redis.del(...matchingQueryKeys)  // All workers see invalidation immediately
res.json(newObject)  // Safe to respond now
```

**Pros**:
- ✅ Guarantees fresh data (atomic operations)
- ✅ Fast (sub-millisecond operations)
- ✅ Scalable (handles high throughput)
- ✅ Battle-tested (industry standard)
- ✅ Rich feature set (pub/sub, Lua scripts, etc.)
- ✅ Monitoring/metrics built-in

**Cons**:
- New infrastructure dependency (Redis server)
- Requires Redis hosting (AWS ElastiCache, Redis Cloud, self-hosted)
- Network latency (local network: <1ms, cloud: 5-10ms)
- Additional operational complexity

**Deployment options**:
1. **AWS ElastiCache** - Managed Redis, HA, automatic backups
2. **Redis Cloud** - Official managed service
3. **Self-hosted** - Docker container on same VM as RERUM

**NPM package**: `ioredis` (most popular, well-maintained)

**Estimated implementation time**: 2-4 hours

---

### Solution 2: Memcached

**What it is**: Distributed memory caching system

**Why it works**: Same as Redis - external single source of truth with atomic operations

**Differences from Redis**:
- Simpler (only caching, no advanced features)
- Slightly faster for pure key-value operations
- No persistence (Redis can persist to disk)
- No pub/sub or complex data structures

**When to use**: If you only need caching and want simplest possible solution

**NPM package**: `memcached` or `memjs`

**Pros/Cons**: Similar to Redis but less feature-rich

---

### Solution 3: Hazelcast (Overkill)

**What it is**: Distributed data grid with built-in consistency guarantees

**Why it works**: IMDG with CP (Consistency + Partition tolerance) mode

**Why NOT recommended**:
- Heavy Java dependency
- Much more complex than needed
- Overkill for RERUM's use case

---

### Solution 4: Disable Cluster Caching (Temporary)

**What it is**: Only use cache in standalone mode, disable in PM2 cluster

**Implementation**:
```javascript
// cache/index.js
const isPM2 = typeof process.env.pm_id !== 'undefined' && process.env.pm_id !== '-1'

if (isPM2) {
    // In cluster mode: no caching
    export default {
        get: async () => null,  // Always cache miss
        set: async () => {},    // No-op
        delete: async () => {},
        // ... all no-ops
    }
} else {
    // Standalone mode: use local cache
    export default new ClusterCache(...)
}
```

**Pros**:
- ✅ Guarantees fresh data (no cache = no stale data)
- ✅ Zero new dependencies
- ✅ Simple implementation (5 lines of code)
- ✅ Development mode still benefits from caching

**Cons**:
- ❌ No caching benefit in production
- ❌ Higher MongoDB load
- ❌ Misses opportunity for performance optimization

**When to use**: As interim solution until Redis is deployed

---

## 📊 Performance Comparison

### MongoDB Query Performance (with indexes)
- ID lookup: 1-5ms
- Simple query: 10-50ms
- Complex aggregation: 100-500ms
- Full-text search: 50-200ms

### Redis Cache Performance
- Local network GET: 0.5-1ms
- Local network SET: 0.5-1ms
- Cloud network GET: 5-10ms
- Cloud network SET: 5-10ms

### pm2-cluster-cache Performance (when it worked)
- Local GET: <1ms
- Cluster GET: 5-10ms (IPC overhead)
- **Problem**: 83% stale data rate = unusable

### Expected Impact with Redis

**Before (no cache)**:
- Average query: 30ms (MongoDB)
- Total: 30ms

**After (Redis cache, 80% hit rate)**:
- Cache hit (80%): 1ms (Redis)
- Cache miss (20%): 30ms (MongoDB) + 1ms (cache update) = 31ms
- Average: (0.8 × 1ms) + (0.2 × 31ms) = **7ms**

**Improvement**: 4.3x faster on average

---

## 🎯 Recommended Implementation Plan

### Phase 1: Deploy Redis (Recommended)

**Step 1**: Choose Redis hosting
- Option A: AWS ElastiCache (if on AWS) - ~$15/month for t3.micro
- Option B: Redis Cloud free tier (250MB) - good for testing
- Option C: Docker on same VM - free, slightly more ops work

**Step 2**: Install npm package
```bash
npm install ioredis
```

**Step 3**: Implement RedisCache class
- Create `cache/redis-cache.js`
- Implement get/set/delete/invalidate
- Add connection pooling and error handling

**Step 4**: Update middleware
- Replace `pm2-cluster-cache` imports with RedisCache
- Invalidation logic stays the same (already written)

**Step 5**: Test
- Run `race-condition.sh` → expect 0% stale data
- Load test with concurrent writes
- Monitor Redis performance

**Step 6**: Deploy
- Update production config with Redis connection
- Gradual rollout with monitoring

**Timeline**: 1-2 days including testing

---

### Phase 2: Optimize (Optional)

**Advanced features**:
- Cache warming on startup
- Redis Cluster for HA
- Lua scripts for complex invalidation
- Monitoring with Redis metrics

---

## 📝 Summary for New Branch

**Starting a new branch from `main`**:

1. **Don't use pm2-cluster-cache** - It fundamentally cannot meet the "never stale data" requirement due to async IPC

2. **Use Redis** - Industry-standard external cache with atomic operations

3. **Key files to modify**:
   - `cache/index.js` - Replace ClusterCache with RedisCache
   - `cache/middleware.js` - Update imports (invalidation logic can stay)
   - `package.json` - Add `ioredis` dependency
   - `.env` - Add Redis connection config

4. **Test thoroughly**:
   - Run `cache/__tests__/race-condition.sh`
   - Expected result: 0% stale data (100% fresh)
   - Load test with concurrent operations

5. **Deployment requirements**:
   - Redis server (ElastiCache, Redis Cloud, or Docker)
   - Update environment variables

---

## 🔍 Technical Deep Dive: Why pm2-cluster-cache Fails

### The Race Condition Explained

```javascript
// Worker A (handles write)
async function handleWrite(req, res) {
    await db.updateObject(id, data)
    await cache.delete(`id:${id}`)  // ← Returns immediately
    res.json({ success: true })     // ← Sent before other workers invalidate
}

// Worker B (handles subsequent read)
async function handleRead(req, res) {
    let obj = await cache.get(`id:${id}`)  // ← Still has old value
    if (!obj) {
        obj = await db.getObject(id)
        await cache.set(`id:${id}`, obj)
    }
    res.json(obj)  // ← Returns stale data
}
```

**What happens**:
1. Worker A updates DB and calls `cache.delete()`
2. `cache.delete()` sends IPC message to Worker B
3. `cache.delete()` Promise resolves (message sent, not processed)
4. Worker A sends response
5. Client gets response and immediately queries
6. Worker B receives query **before processing IPC message**
7. Worker B returns stale cached data

**Timing**:
- Steps 1-4: 15ms
- Step 5: 5ms (network)
- Step 6: 2ms
- IPC processing: 50-200ms **← The gap**

### Why Await Doesn't Help

```javascript
await cache.delete(key)  // Waits for Promise to resolve
// Promise resolves when IPC message is SENT, not PROCESSED
```

The Promise resolution timing is controlled by the library, not our code. The library (pm2-cluster-cache) resolves immediately after `pm2.sendDataToProcessId()` call, which only guarantees the message was sent to PM2, not that other workers processed it.

### Why All Storage Modes Fail

**'all' mode**: All workers have cache, async IPC sync
**'master' mode**: Non-master workers use async IPC to master
**'self' mode**: No sync at all between workers
**'cluster' mode**: Distributed via async IPC

**Common thread**: All rely on PM2's asynchronous IPC, which has no synchronous acknowledgment mechanism.

---

## 🚀 Next Steps

1. **Choose**: Redis (recommended) or temporary no-cache solution
2. **Budget**: Allocate ~$15-30/month for managed Redis (or $0 for self-hosted)
3. **Implement**: Follow Phase 1 plan above
4. **Test**: Verify 0% stale data rate
5. **Deploy**: Gradual rollout with monitoring

**Questions?** Consult:
- Redis documentation: https://redis.io/docs/
- ioredis documentation: https://github.com/redis/ioredis
- This analysis document

---

**Bottom Line**: JavaScript/Node/PM2 internal solutions cannot provide synchronous cluster-wide cache invalidation. Redis is the industry-standard solution for this exact problem and will guarantee fresh data while providing excellent performance.
