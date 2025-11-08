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

---

## 🔄 Update: AWS ElastiCache as External Managed Service (2025-11-08)

### Decision: Use AWS ElastiCache Redis (or Redis Alternative)

**Status**: Recommended implementation path
**Reason**: Team has existing AWS ElastiCache account; perfect fit for external managed cache service

### Redis Deployment Options

RERUM needs an external Redis instance that all PM2 workers can connect to. Here are your options:

#### Option 1: AWS ElastiCache (Recommended for Production)

**Best for**: Production deployment with team's existing AWS infrastructure

**Pros**:
- ✅ Fully managed service (AWS handles everything)
- ✅ Automatic backups and point-in-time recovery
- ✅ Built-in monitoring via CloudWatch
- ✅ High availability with automatic failover (optional)
- ✅ Same VPC as RERUM server = low latency
- ✅ Team already has AWS account/access
- ✅ Consistent with MongoDB Atlas pattern

**Cons**:
- ❌ Costs ~$13-16/month (cache.t3.micro)
- ❌ Requires AWS Console setup

**Setup time**: 30 minutes
**Monthly cost**: $13-16

---

#### Option 2: Redis Cloud Free Tier (Good for Testing/Small Scale)

**Best for**: Development, testing, or low-traffic production

**Pros**:
- ✅ Free tier: 30MB RAM, 30 connections
- ✅ Fully managed (Redis Labs handles operations)
- ✅ Quick setup (5-10 minutes)
- ✅ Works from anywhere (public endpoint)
- ✅ Automatic backups included
- ✅ Simple web dashboard

**Cons**:
- ❌ 30MB limit (may be tight for heavy use)
- ❌ Public endpoint (slightly higher latency than VPC)
- ❌ Connection limits (30 concurrent)

**Setup**:
1. Sign up at https://redis.com/try-free/
2. Create database → Copy endpoint
3. Use endpoint in `.env`:
   ```bash
   REDIS_HOST=redis-12345.c123.us-east-1-2.ec2.cloud.redislabs.com
   REDIS_PORT=12345
   REDIS_PASSWORD=your_password_here
   REDIS_TLS=true
   ```

**Setup time**: 10 minutes
**Monthly cost**: $0 (free tier)

---

#### Option 3: Self-Hosted Redis on Same VM (Development Only)

**Best for**: Local development, NOT for production

**Pros**:
- ✅ Free
- ✅ Fast setup (5 minutes)
- ✅ Full control
- ✅ No external dependencies

**Cons**:
- ❌ You manage updates, backups, monitoring
- ❌ Uses RERUM server resources (RAM/CPU)
- ❌ No built-in HA/failover
- ❌ Manual scaling required
- ❌ Operational burden

**Setup on vlcdhprdp02** (RHEL):
```bash
# Option A: Docker (Recommended for self-hosted)
docker run -d \
  --name redis \
  --restart unless-stopped \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine redis-server --appendonly yes

# Option B: Native install (RHEL)
sudo yum install redis -y
sudo systemctl enable redis
sudo systemctl start redis

# .env configuration
REDIS_HOST=localhost
REDIS_PORT=6379
```

**Setup time**: 5-10 minutes
**Monthly cost**: $0 (uses existing VM)

---

#### Option 4: Other Managed Redis Services

**Alternatives to consider**:

**Upstash Redis** (https://upstash.com):
- Serverless pricing model (pay per request)
- Free tier: 10K commands/day
- Global edge locations (low latency)
- Good for: Variable/unpredictable traffic

**DigitalOcean Managed Redis** (https://www.digitalocean.com/products/managed-databases):
- Starting at $15/month (1GB RAM)
- Simple interface
- Good for: Teams already on DigitalOcean

**Aiven Redis** (https://aiven.io):
- Multi-cloud (AWS, GCP, Azure)
- Starting at $20/month
- Good for: Multi-region needs

---

### Recommendation Matrix

| Scenario | Recommended Option | Why |
|----------|-------------------|-----|
| **Production (current setup)** | AWS ElastiCache | Already have AWS, matches MongoDB Atlas pattern |
| **Testing/Staging** | Redis Cloud Free | Free, managed, quick setup |
| **Local Development** | Docker Redis | Fast, no dependencies, isolated |
| **Cost-Sensitive Production** | Redis Cloud Free → Paid | Start free, upgrade as needed |
| **Multi-Cloud Strategy** | Aiven or Upstash | Cloud-agnostic |

**For RERUM**: AWS ElastiCache is the best fit given existing infrastructure.

---

### Why AWS ElastiCache Is Ideal For RERUM

**Similar to MongoDB Atlas architecture**:
- RERUM already uses MongoDB Atlas as external managed database
- ElastiCache follows same pattern: external managed cache service
- No server management, automatic backups, built-in monitoring
- Integrates seamlessly with existing AWS infrastructure

**Current RERUM Infrastructure**:
```
GitHub Actions CI/CD
    ↓
Deploys to: vlcdhprdp02 (RHEL VM, 4-core)
    ↓
PM2 Cluster (4 workers) - pm2 start -i max
    ↓
MongoDB Atlas (external managed database)
    ↓
[NEW] AWS ElastiCache Redis (external managed cache)
```

### Architecture: All Workers → Single ElastiCache

```
┌─────────────────────────────────────────┐
│     PM2 Cluster on vlcdhprdp02          │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │Worker 1│ │Worker 2│ │Worker 3│ ...  │
│  └────┬───┘ └────┬───┘ └────┬───┘      │
│       │          │          │           │
└───────┼──────────┼──────────┼───────────┘
        │          │          │
        └──────────┴──────────┘
                   ↓
        ┌──────────────────────┐
        │  AWS ElastiCache     │
        │  Redis Cluster       │
        │  (Managed Service)   │
        └──────────────────────┘
                   ↓
        ┌──────────────────────┐
        │  MongoDB Atlas       │
        │  (Managed Service)   │
        └──────────────────────┘
```

**Key benefit**: Just like MongoDB Atlas, all PM2 workers connect to the same external ElastiCache instance, ensuring atomic cache operations with zero stale data.

---

## 📋 AWS ElastiCache Implementation Guide

### Phase 1: AWS ElastiCache Setup

#### Step 1.1: Create Redis Cluster in AWS Console

**Navigate to ElastiCache**:
1. AWS Console → ElastiCache → Get Started
2. Choose: **Redis OSS** (not Memcached)

**Cluster Configuration**:
```yaml
Cluster mode: Disabled           # Simpler, sufficient for RERUM
Name: rerum-v1-cache
Engine version: Redis 7.x        # Latest stable
Node type: cache.t3.micro        # $12-15/month, good for starting
Number of replicas: 0            # Start simple, add HA later
Port: 6379                       # Default Redis port
```

**CRITICAL: Network & Security Configuration**:
```yaml
VPC: Same VPC as vlcdhprdp02        # MUST be same VPC as RERUM server
Subnet group: Private subnet         # Redis should not be public
Security group: Create new or modify existing
  - Inbound rule:
      Type: Custom TCP
      Port: 6379
      Source: Security group of vlcdhprdp02
      Description: Allow Redis from RERUM API server
```

**Why this matters**: ElastiCache must be in same VPC as `vlcdhprdp02` for low-latency private network access. Public internet access would be slower and less secure.

**Optional Configuration**:
```yaml
Encryption at rest: Optional (adds security)
Encryption in transit: Optional (TLS)
Backup retention: 1 day (recommended)
Maintenance window: Set to low-traffic period
```

**Create & Wait**: Cluster creation takes ~10-15 minutes.

#### Step 1.2: Get Connection Endpoint

After creation:
1. Click on cluster name: `rerum-v1-cache`
2. Copy **Primary Endpoint**:
   - Format: `rerum-v1-cache.xxxxxx.0001.use1.cache.amazonaws.com:6379`
   - Or just hostname: `rerum-v1-cache.xxxxxx.0001.use1.cache.amazonaws.com`

**Save this endpoint** - you'll add it to environment variables.

---

### Phase 2: Code Implementation

#### Step 2.1: Update Dependencies

**Add to `package.json`**:
```json
{
  "dependencies": {
    "ioredis": "^5.3.2",
    // ... existing dependencies
  }
}
```

**Install**:
```bash
npm install ioredis
```

**Why ioredis**: Most popular Node.js Redis client, excellent AWS ElastiCache support, actively maintained.

#### Step 2.2: Environment Variables

**Add to `.env` (local development)**:
```bash
# AWS ElastiCache Redis Configuration
CACHE_ENABLED=true
REDIS_HOST=localhost                    # Use local Redis for dev
REDIS_PORT=6379
REDIS_PASSWORD=                         # Empty if no auth
REDIS_TLS=false                         # VPC internal = no TLS needed
CACHE_TTL=300000                        # 5 minutes (300,000 ms)
```

**Update GitHub Secret `PROD_FULL_ENV`** (production):
```bash
# Add to existing secret
CACHE_ENABLED=true
REDIS_HOST=rerum-v1-cache.xxxxxx.0001.use1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=                         # ElastiCache in VPC typically no password
REDIS_TLS=false
CACHE_TTL=300000
```

**Note**: ElastiCache within same VPC doesn't require TLS or password by default (uses VPC security groups). If you enable encryption in transit, set `REDIS_TLS=true`.

#### Step 2.3: Environment Variable Examples for Different Redis Options

**AWS ElastiCache** (Production):
```bash
CACHE_ENABLED=true
REDIS_HOST=rerum-v1-cache.xxxxxx.0001.use1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=                         # Empty (VPC security)
REDIS_TLS=false                         # VPC internal = no TLS
CACHE_TTL=300000
```

**Redis Cloud Free Tier**:
```bash
CACHE_ENABLED=true
REDIS_HOST=redis-12345.c123.us-east-1-2.ec2.cloud.redislabs.com
REDIS_PORT=12345                        # Custom port from Redis Cloud
REDIS_PASSWORD=your_password_here       # Required
REDIS_TLS=true                          # Required for Redis Cloud
CACHE_TTL=300000
```

**Local Docker Redis** (Development):
```bash
CACHE_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                         # Empty for local
REDIS_TLS=false
CACHE_TTL=300000
```

**Upstash Redis**:
```bash
CACHE_ENABLED=true
REDIS_HOST=usw1-sharp-cicada-12345.upstash.io
REDIS_PORT=6379
REDIS_PASSWORD=your_upstash_token       # Required
REDIS_TLS=true                          # Required
CACHE_TTL=300000
```

**The code is the same for all options** - only environment variables change!

#### Step 2.4: Development vs Production Setup

**For local development** (before ElastiCache ready):
```bash
# Run Redis locally with Docker
docker run -d --name redis -p 6379:6379 redis:alpine

# .env uses localhost
REDIS_HOST=localhost
```

**For production** (after ElastiCache created):
```bash
# .env uses ElastiCache endpoint
REDIS_HOST=rerum-v1-cache.xxxxxx.0001.use1.cache.amazonaws.com
```

**Same code works for both** - only endpoint changes!

---

### Phase 3: Cache Target Operations

**Primary Focus**: Cache expensive query and search operations

**Operations to cache**:
1. ✅ **POST `/api/query`** - Complex MongoDB queries (10-100ms → 1ms cached)
2. ✅ **POST `/api/search`** - Full-text search (50-200ms → 1ms cached)
3. ⚠️ **GET `/id/{id}`** - Consider caching (1-5ms → <1ms cached, minimal gain)
4. ⚠️ **GET `/history/{id}`** - Consider if slow (measure first)
5. ⚠️ **GET `/since/{id}`** - Consider if slow (measure first)

**Operations that invalidate cache** (all write operations):
- POST `/api/create`
- PUT `/api/update`
- PATCH `/api/patch`
- PATCH `/api/set`
- PATCH `/api/unset`
- POST `/api/overwrite`
- DELETE `/api/delete`
- POST `/api/release`
- POST `/api/bulkCreate`
- POST `/api/bulkUpdate`

**Invalidation strategy**: Conservative approach
- Any write operation → invalidate ALL query/search caches
- Simple, safe, guarantees 0% stale data
- Can optimize later with selective invalidation if needed

---

### Phase 4: Key Implementation Files

**File structure** (to be created in implementation):
```
cache/
├── index.js              # ElastiCache Redis client wrapper
├── middleware.js         # Express middleware for caching
├── utils.js              # Cache key generation, helpers
├── routes.js             # Cache management endpoints
└── __tests__/
    └── cache.test.js     # Unit tests
```

**Core features**:
- Automatic failover to MongoDB if Redis unavailable
- Connection retry logic with exponential backoff
- Performance metrics (hits, misses, hit rate)
- Health check endpoint
- Manual cache clear endpoint (admin)

---

### Phase 5: Deployment Process

#### Step 5.1: Testing Sequence

**Local testing** (with Docker Redis):
```bash
# 1. Start local Redis
docker run -d --name redis -p 6379:6379 redis:alpine

# 2. Update .env for local
REDIS_HOST=localhost

# 3. Start RERUM
npm start

# 4. Test cache endpoints
curl http://localhost:3005/v1/api/cache/health
curl http://localhost:3005/v1/api/cache/stats

# 5. Test query caching
curl -X POST http://localhost:3005/v1/api/query \
  -H "Content-Type: application/json" \
  -d '{"test": "value"}'

# 6. Check stats (should show 1 miss, then 1 hit on repeat)
```

**Production deployment**:
```bash
# 1. Commit code to branch
git add cache/
git commit -m "Add AWS ElastiCache Redis caching layer"
git push origin 224-load-balanced-caching

# 2. Create PR to main
# 3. GitHub Actions runs tests
# 4. Merge to main
# 5. Auto-deploys to vlcdhprdp02
# 6. PM2 restarts with: pm2 start -i max bin/rerum_v1.js
```

#### Step 5.2: Post-Deployment Verification

**Check PM2 logs**:
```bash
ssh vlcdhprdp02
pm2 logs rerum_v1 --lines 50

# Look for:
# ✅ Connected to AWS ElastiCache Redis
# ✅ Redis ready for operations
```

**Test production cache**:
```bash
# Health check
curl https://store.rerum.io/v1/api/cache/health

# Stats
curl https://store.rerum.io/v1/api/cache/stats

# Expected response:
{
  "enabled": true,
  "hits": 0,
  "misses": 0,
  "hitRate": "0%",
  "errors": 0
}
```

**Monitor over time**:
```bash
# Check hit rate after 1 hour
curl https://store.rerum.io/v1/api/cache/stats

# Target: >70% hit rate for queries/searches
```

---

### Phase 6: Cost & Performance

#### Cost Breakdown

**AWS ElastiCache Redis**:
```
Node type: cache.t3.micro
  - Memory: 512 MB
  - vCPU: 2
  - Network: Low to Moderate
  - Cost: ~$12-15/month

Backups: Included (1 day retention)
Data transfer: Minimal within VPC (~$1/month)

Total estimated cost: ~$13-16/month
```

**Cost-Benefit Analysis**:
```
MongoDB Atlas cost reduction:
  - Fewer queries = lower compute cost
  - Estimated savings: ~$5-10/month

Net additional cost: ~$3-11/month
Benefit: 4-10x faster query/search responses
```

#### Performance Expectations

**Before caching** (MongoDB Atlas):
```
Query operation: 30ms average
Search operation: 100ms average
Daily queries: ~10,000
Total query time: 300 seconds/day
```

**After caching** (80% hit rate):
```
Cache hit (80%): 1ms
Cache miss (20%): 30ms + 1ms write = 31ms
Average: (0.8 × 1) + (0.2 × 31) = 7ms

Improvement: 4.3x faster
Total query time: 70 seconds/day
Time saved: 230 seconds/day
```

**User experience impact**:
- Most queries return in <10ms (vs 30-100ms before)
- Reduces perceived latency significantly
- Better for bursty traffic patterns

---

## 🎯 Final Implementation Checklist

### AWS Setup
- [ ] Create ElastiCache Redis cluster in AWS Console
- [ ] Configure in same VPC as `vlcdhprdp02`
- [ ] Set up security group allowing port 6379 from RERUM server
- [ ] Copy primary endpoint URL
- [ ] Test connectivity from `vlcdhprdp02` (optional: `telnet <endpoint> 6379`)

### Code Implementation
- [ ] Add `ioredis` to `package.json`
- [ ] Create `cache/` directory with core files
- [ ] Implement Redis client wrapper (`cache/index.js`)
- [ ] Implement cache middleware (`cache/middleware.js`)
- [ ] Add cache routes (`cache/routes.js`)
- [ ] Integrate middleware into query/search routes
- [ ] Integrate invalidation into all write routes
- [ ] Write unit tests

### Configuration
- [ ] Add Redis environment variables to `.env`
- [ ] Update GitHub secret `PROD_FULL_ENV` with ElastiCache endpoint
- [ ] Set `CACHE_ENABLED=true` in production config

### Testing
- [ ] Test locally with Docker Redis
- [ ] Verify cache hits/misses with stats endpoint
- [ ] Test write operations trigger invalidation
- [ ] Run existing test suite (should still pass)
- [ ] Load test with concurrent requests (optional)

### Deployment
- [ ] Push code to `224-load-balanced-caching` branch
- [ ] Create PR to `main`
- [ ] Review and merge
- [ ] Monitor GitHub Actions deployment
- [ ] Verify PM2 logs show Redis connection
- [ ] Check `/api/cache/health` and `/api/cache/stats` endpoints
- [ ] Monitor hit rate over 24 hours

### Post-Deployment
- [ ] Set up CloudWatch alerts for ElastiCache (optional)
- [ ] Monitor Redis memory usage
- [ ] Track cache hit rate trend
- [ ] Document any issues or optimizations needed
- [ ] Consider adding cache warming on startup (future optimization)

---

## 📊 Comparison: Redis Deployment Options

### Quick Comparison Table

| Solution | Setup Time | Monthly Cost | Memory | Ops Burden | Reliability | Performance | Best For |
|----------|-----------|--------------|--------|------------|-------------|-------------|----------|
| **AWS ElastiCache** | 30 min | $13-16 | 512MB+ | None | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Production |
| **Redis Cloud Free** | 10 min | $0 | 30MB | None | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Dev/Test |
| **Self-hosted Docker** | 10 min | $0 | Flexible | Medium | ⭐⭐⭐ | ⭐⭐⭐⭐ | Local Dev |
| **Self-hosted Native** | 15 min | $0 | Flexible | High | ⭐⭐⭐ | ⭐⭐⭐⭐ | Local Dev |
| **Upstash** | 10 min | $0-10+ | Pay/use | None | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Serverless |
| **DigitalOcean** | 20 min | $15+ | 1GB+ | None | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | DO users |
| **pm2-cluster-cache** | 0 min | $0 | N/A | None | ⭐ (83% stale) | ❌ | DON'T USE |

### Detailed Comparison

#### AWS ElastiCache
- **Pros**: Managed, AWS integration, same VPC as RERUM, automatic backups, CloudWatch monitoring
- **Cons**: Costs money, requires AWS Console access
- **When to use**: Production with existing AWS infrastructure (RERUM's case)

#### Redis Cloud Free Tier
- **Pros**: Free, managed, quick setup, good for testing
- **Cons**: 30MB limit, public endpoint, 30 connection limit
- **When to use**: Development, testing, proof-of-concept, low-traffic production

#### Self-Hosted Docker Redis
- **Pros**: Free, isolated, easy to reset, version control
- **Cons**: Manual backups, monitoring, updates; uses VM resources
- **When to use**: Local development, CI/CD testing

#### Self-Hosted Native Redis
- **Pros**: Native performance, full control, no Docker overhead
- **Cons**: System-wide install, harder to isolate, manual everything
- **When to use**: Long-term self-hosted production (not recommended for RERUM)

#### Upstash Redis
- **Pros**: Serverless pricing, edge locations, REST API, global
- **Cons**: Pay per request (can be unpredictable), less traditional
- **When to use**: Variable traffic, multi-region apps, edge computing

#### DigitalOcean Managed Redis
- **Pros**: Simple UI, good docs, predictable pricing
- **Cons**: More expensive than ElastiCache, requires DO account
- **When to use**: Already using DigitalOcean infrastructure

**Winner for RERUM**: AWS ElastiCache (already have account, managed service, perfect fit with existing AWS/MongoDB Atlas setup)

---

## 🚀 Success Metrics

**Phase 1 Success** (Initial deployment):
- ✅ ElastiCache connected, no errors in logs
- ✅ Cache hit rate >50% after 24 hours
- ✅ Average query response time <10ms
- ✅ Zero cache-related errors reported

**Phase 2 Success** (After 1 week):
- ✅ Cache hit rate >70%
- ✅ Reduced MongoDB Atlas query count by >60%
- ✅ User-reported performance improvements
- ✅ No stale data incidents

**Long-term Success** (After 1 month):
- ✅ Cache hit rate stabilized >75%
- ✅ Cost-neutral or cost-savings vs increased MongoDB usage
- ✅ ElastiCache memory usage <80%
- ✅ Plan for scaling if needed (add replicas, larger instance)

---

## 🔮 Future Optimizations (Post-MVP)

Once basic caching is working well:

1. **Selective Invalidation**
   - Instead of clearing all queries on write, analyze which queries affected
   - Use object properties to match cache keys
   - Reduces unnecessary cache clears

2. **Cache Warming**
   - Pre-populate common queries on server startup
   - Reduces initial cold cache period
   - Improves user experience after deployments

3. **Redis Cluster Mode**
   - Enable cluster mode for horizontal scaling
   - Add read replicas for HA
   - Automatic failover

4. **Advanced Monitoring**
   - CloudWatch dashboards for ElastiCache
   - Alert on high memory usage
   - Track slow queries that should be cached

5. **TTL Tuning**
   - Analyze data change patterns
   - Set different TTLs for different operation types
   - Balance freshness vs hit rate

---

## 📖 Documentation References

**AWS ElastiCache**:
- Getting Started: https://docs.aws.amazon.com/elasticache/latest/red-ug/GettingStarted.html
- Best Practices: https://docs.aws.amazon.com/elasticache/latest/red-ug/BestPractices.html
- Node.js Connection: https://docs.aws.amazon.com/elasticache/latest/red-ug/nodes-connecting.html

**ioredis**:
- Documentation: https://github.com/redis/ioredis
- API Reference: https://redis.github.io/ioredis/
- AWS ElastiCache Examples: https://github.com/redis/ioredis#connect-to-redis

**RERUM Specific**:
- MongoDB Atlas connection pattern: See `database/index.js`
- PM2 cluster deployment: See `.github/workflows/cd_prod.yaml`
- Environment configuration: See `.env` and GitHub Secrets

---

## 🔧 Troubleshooting Redis Connection Issues

### Common Connection Problems

#### Problem 1: "ECONNREFUSED" Error

```bash
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Cause**: Redis server not running or wrong host/port

**Solutions**:
```bash
# Check if Redis is running (Docker)
docker ps | grep redis

# Check if Redis is running (native)
sudo systemctl status redis

# Test connection manually
telnet localhost 6379
# or
redis-cli ping

# Verify environment variables
echo $REDIS_HOST
echo $REDIS_PORT
```

---

#### Problem 2: "ETIMEDOUT" or Connection Timeout

```bash
Error: connect ETIMEDOUT
```

**Cause**: Network/firewall blocking connection, wrong endpoint, or VPC issue

**Solutions for AWS ElastiCache**:
```bash
# 1. Verify security group allows port 6379
#    - Inbound rule for port 6379
#    - Source = Security group of vlcdhprdp02

# 2. Verify same VPC
#    - ElastiCache must be in same VPC as RERUM server

# 3. Test from RERUM server
ssh vlcdhprdp02
telnet <elasticache-endpoint> 6379

# 4. Check subnet routing
#    - ElastiCache should be in private subnet with route to RERUM
```

**Solutions for Redis Cloud**:
```bash
# 1. Verify endpoint is correct (copy from Redis Cloud dashboard)
# 2. Check port number (often custom, not 6379)
# 3. Verify TLS is enabled: REDIS_TLS=true
# 4. Check password is correct
```

---

#### Problem 3: "WRONGPASS" or Authentication Failed

```bash
Error: WRONGPASS invalid username-password pair
```

**Cause**: Wrong password or missing password

**Solutions**:
```bash
# AWS ElastiCache (VPC internal):
REDIS_PASSWORD=        # Leave empty, uses security groups

# Redis Cloud:
REDIS_PASSWORD=<copy-from-dashboard>

# Check password in Redis Cloud:
# Dashboard → Database → Security → Default user password

# Test connection with password:
redis-cli -h <host> -p <port> -a <password> --tls ping
```

---

#### Problem 4: Certificate/TLS Errors

```bash
Error: unable to verify the first certificate
Error: self signed certificate
```

**Cause**: TLS mismatch or certificate issues

**Solutions**:
```bash
# For Redis Cloud and Upstash - TLS required:
REDIS_TLS=true

# For AWS ElastiCache in VPC - no TLS:
REDIS_TLS=false

# If using ElastiCache with encryption in transit:
REDIS_TLS=true

# For self-signed certs (dev only), update code:
const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    tls: process.env.REDIS_TLS === 'true' ? {
        rejectUnauthorized: false  // Dev only!
    } : undefined
})
```

---

#### Problem 5: "Too Many Connections"

```bash
Error: max number of clients reached
```

**Cause**: Connection limit exceeded

**Solutions**:
```bash
# Redis Cloud Free: Max 30 connections
# - Reduce PM2 workers: pm2 start -i 2
# - Upgrade to paid tier

# Check current connections:
redis-cli -h <host> -p <port> -a <password> info clients

# Configure connection pooling in code:
const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    // Don't create too many connections
    // ioredis reuses connections automatically
})
```

---

#### Problem 6: Cache Works But Data is Stale

**Cause**: Invalidation not triggering properly

**Debug steps**:
```bash
# 1. Check if invalidation middleware is applied
# Look for: invalidateQueryCache() in write routes

# 2. Test invalidation manually
curl -X POST https://store.rerum.io/v1/api/cache/clear

# 3. Check logs for invalidation messages
pm2 logs rerum_v1 | grep "Invalidated"

# 4. Verify response is sent AFTER invalidation completes
# The middleware must await invalidation before res.json()
```

**Verify middleware order**:
```javascript
// CORRECT: Invalidation runs before response sent
router.post('/', checkJwt, invalidateQueryCache(), controller.create)

// WRONG: Invalidation might run after response
router.post('/', checkJwt, controller.create, invalidateQueryCache())
```

---

#### Problem 7: RERUM Works But No Cache Benefit

**Symptoms**: Cache stats show 0% hit rate

**Debug steps**:
```bash
# 1. Check cache is enabled
curl https://store.rerum.io/v1/api/cache/stats
# Should show: "enabled": true

# 2. Verify middleware is applied to routes
# Check routes/query.js and routes/search.js

# 3. Test query caching
curl -X POST https://store.rerum.io/v1/api/query \
  -H "Content-Type: application/json" \
  -d '{"test": "value"}'
  
# Run twice - second should be cache hit
curl https://store.rerum.io/v1/api/cache/stats
# Should show: "hits": 1

# 4. Check PM2 logs for cache messages
pm2 logs rerum_v1 | grep -i cache
```

---

#### Problem 8: Memory Issues / Redis Out of Memory

```bash
Error: OOM command not allowed when used memory > 'maxmemory'
```

**Cause**: Redis memory limit reached

**Solutions**:
```bash
# AWS ElastiCache:
# - Upgrade to larger instance (t3.small = 1.37GB)
# - Monitor memory in CloudWatch

# Redis Cloud Free:
# - 30MB limit - may need paid tier
# - Reduce TTL to cache less data

# Check memory usage:
redis-cli -h <host> -p <port> info memory

# Adjust TTL in .env:
CACHE_TTL=180000  # 3 minutes instead of 5
```

---

### Quick Diagnostic Checklist

When Redis isn't working, check in this order:

1. ✅ **Environment variables set correctly** in `.env` or GitHub Secrets
2. ✅ **Redis server is running** (Docker/native/ElastiCache status)
3. ✅ **Network allows connection** (security groups, VPC, firewall)
4. ✅ **TLS setting matches Redis service** (true for Cloud, false for VPC ElastiCache)
5. ✅ **Password is correct** (or empty for VPC ElastiCache)
6. ✅ **Middleware is applied** to query/search routes
7. ✅ **Invalidation middleware** is applied to write routes
8. ✅ **PM2 logs show Redis connected** message

---

## ✅ Summary: Redis-Based Caching for RERUM

### The Solution: External Redis Service

**Core Principle**: PM2 cluster workers need a shared external cache service (just like MongoDB Atlas) to guarantee synchronization across all processes.

### Why External Redis Works

1. **PM2 Compatible**: All workers connect to same Redis instance = guaranteed consistency
2. **Zero Stale Data**: Atomic operations eliminate race conditions that plagued pm2-cluster-cache
3. **Proven Architecture**: Industry standard for exactly this problem (Netflix, GitHub, Twitter all use Redis for caching)
4. **Consistent Pattern**: Mirrors MongoDB Atlas architecture (external managed service)
5. **Guaranteed Fresh Data**: Redis DEL operations are atomic and synchronous across all clients

### Redis Deployment Options for RERUM

| Option | Best For | Setup Time | Monthly Cost |
|--------|----------|-----------|--------------|
| **AWS ElastiCache** | **Production (Recommended)** | 30 min | $13-16 |
| Redis Cloud Free | Dev/Test/Small Scale | 10 min | $0 (30MB) |
| Docker Redis | Local Development | 5 min | $0 |
| Upstash | Serverless/Variable Traffic | 10 min | $0-10+ |

### Why AWS ElastiCache is Best for RERUM

1. **Existing Infrastructure**: Team already has AWS account and ElastiCache access
2. **Consistent Pattern**: Mirrors MongoDB Atlas architecture (external managed service)
3. **Same VPC**: Low-latency private connection to `vlcdhprdp02` RERUM server
4. **Zero Ops Burden**: AWS manages backups, updates, monitoring, scaling
5. **Cost Effective**: ~$13-16/month, likely offset by reduced MongoDB Atlas query costs
6. **Easy Integration**: Same connection pattern as MongoDB - just add endpoint to environment variables
7. **Production Ready**: Automatic failover, CloudWatch monitoring, point-in-time backups

### Implementation Summary

**Code required**:
- `cache/index.js` - Redis client wrapper (~100 lines)
- `cache/middleware.js` - Express middleware (~80 lines)
- `cache/routes.js` - Management endpoints (~50 lines)
- `cache/utils.js` - Helper functions (~50 lines)
- Integration into existing routes (~5 lines per route)

**Configuration required**:
- Add `ioredis` dependency to `package.json`
- Add Redis environment variables to `.env` and GitHub Secrets
- Create ElastiCache cluster in AWS Console (30 minutes)

**Expected benefits**:
- 4-10x faster query/search responses (50-200ms → 5-20ms)
- Reduced MongoDB Atlas load (60-80% fewer queries)
- Better handling of traffic spikes
- Improved user experience
- Zero stale data (guaranteed fresh)

**Bottom line**: AWS ElastiCache Redis solves the cluster caching problem perfectly while fitting naturally into RERUM's existing managed services architecture. Alternative Redis options (Cloud, Docker, Upstash) work with the exact same code - only connection details change.
