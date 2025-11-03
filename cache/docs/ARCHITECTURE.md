# RERUM API Caching Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Applications                       │
│  (Web Apps, Desktop Apps, Mobile Apps using RERUM API)         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RERUM API Server (Node.js/Express)         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Route Layer                             │   │
│  │  /query  /search  /id  /history  /since  /gog/*        │   │
│  │  /create  /update  /delete  /patch  /release            │   │
│  └────────────────┬────────────────────────────────────────┘   │
│                   │                                              │
│                   ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Cache Middleware Layer                      │   │
│  │                                                           │   │
│  │  Read Ops:           Write Ops:                         │   │
│  │  • cacheQuery        • invalidateCache (smart)          │   │
│  │  • cacheSearch       • Intercepts response              │   │
│  │  • cacheSearchPhrase • Extracts object properties       │   │
│  │  • cacheId           • Invalidates matching queries     │   │
│  │  • cacheHistory      • Handles version chains           │   │
│  │  • cacheSince                                           │   │
│  │  • cacheGogFragments                                    │   │
│  │  • cacheGogGlosses                                      │   │
│  └────────────┬─────────────────────┬────────────────────────┘   │
│               │                     │                            │
│     ┌─────────▼─────────┐          │                            │
│     │  PM2 Cluster Cache│          │                            │
│     │   (In-Memory)     │          │                            │
│     │                   │          │                            │
│     │  Max: 1000 items  │          │                            │
│     │  Max: 1GB monitor │          │                            │
│     │  TTL: 5 minutes   │          │                            │
│     │  Mode: 'all'      │          │                            │
│     │  (full replicate) │          │                            │
│     │                   │          │                            │
│     │  Cache Keys:      │          │                            │
│     │  • id:{id}        │          │                            │
│     │  • query:{json}   │          │                            │
│     │  • search:{json}  │          │                            │
│     │  • searchPhrase   │          │                            │
│     │  • history:{id}   │          │                            │
│     │  • since:{id}     │          │                            │
│     │  • gogFragments   │          │                            │
│     │  • gogGlosses     │          │                            │
│     └───────────────────┘          │                            │
│                                    │                            │
│                   ┌────────────────▼──────────────────┐         │
│                   │    Controller Layer                │         │
│                   │  (Business Logic + CRUD)           │         │
│                   └────────────────┬──────────────────┘         │
└────────────────────────────────────┼────────────────────────────┘
                                     │
                                     ▼
                   ┌──────────────────────────────────┐
                   │      MongoDB Atlas 8.2.1         │
                   │      (JSON Database)             │
                   │                                  │
                   │  Collections:                    │
                   │  • RERUM Objects (versioned)     │
                   │  • Annotations                   │
                   │  • GOG Data                      │
                   └──────────────────────────────────┘
```

## Request Flow Diagrams

### Cache HIT Flow (Fast Path)

```
Client Request
     │
     ▼
┌────────────────┐
│ Route Handler  │
└───────┬────────┘
        │
        ▼
┌────────────────────┐
│ Cache Middleware   │
│ • Check cache key  │
└────────┬───────────┘
         │
         ▼
    ┌────────┐
    │ Cache? │ YES ──────────┐
    └────────┘               │
                             ▼
                    ┌────────────────┐
                    │ Return Cached  │
                    │ X-Cache: HIT   │
                    │ ~1-5ms        │
                    └────────┬───────┘
                             │
                             ▼
                     Client Response
```

### Cache MISS Flow (Database Query)

```
Client Request
     │
     ▼
┌────────────────┐
│ Route Handler  │
└───────┬────────┘
        │
        ▼
┌────────────────────┐
│ Cache Middleware   │
│ • Check cache key  │
└────────┬───────────┘
         │
         ▼
    ┌────────┐
    │ Cache? │ NO
    └────┬───┘
         │
         ▼
┌────────────────────┐
│   Controller       │
│ • Query MongoDB    │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  MongoDB Atlas     │
│ • Execute query    │
│ • Return results   │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Cache Middleware   │
│ • Store in cache   │
│ • Set TTL timer    │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Return Response    │
│ X-Cache: MISS      │
│ ~50-500ms         │
└────────┬───────────┘
         │
         ▼
  Client Response
```

### Write Operation with Smart Cache Invalidation

```
Client Write Request (CREATE/UPDATE/DELETE)
     │
     ▼
┌────────────────────┐
│ Auth Middleware    │
│ • Verify JWT token │
└────────┬───────────┘
         │
         ▼
┌────────────────────────┐
│ Invalidate Middleware  │
│ • Intercept res.json() │
│ • Setup response hook  │
└────────┬───────────────┘
         │
         ▼
┌────────────────────┐
│   Controller       │
│ • Validate input   │
│ • Perform write    │
│ • Return object    │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  MongoDB Atlas     │
│ • Execute write    │
│ • Version objects  │
│ • Return result    │
└────────┬───────────┘
         │
         ▼
┌────────────────────────────┐
│ Response Intercepted       │
│ • Extract object properties│
│ • Determine operation type │
│ • Build invalidation list  │
└────────┬───────────────────┘
         │
         ▼
    ┌─────────────────────────────┐
    │  Smart Cache Invalidation   │
    │                             │
    │  CREATE:                    │
    │  ├─ Match object properties │
    │  ├─ Invalidate queries      │
    │  └─ Invalidate searches     │
    │                             │
    │  UPDATE:                    │
    │  ├─ Invalidate object ID    │
    │  ├─ Match object properties │
    │  ├─ Extract version chain   │
    │  ├─ Invalidate history/*    │
    │  └─ Invalidate since/*      │
    │                             │
    │  DELETE:                    │
    │  ├─ Use res.locals object   │
    │  ├─ Invalidate object ID    │
    │  ├─ Match object properties │
    │  ├─ Extract version chain   │
    │  ├─ Invalidate history/*    │
    │  └─ Invalidate since/*      │
    └─────────┬───────────────────┘
              │
              ▼
       ┌──────────────────┐
       │ Send Response    │
       │ • Original data  │
       │ • 200/201/204    │
       └──────┬───────────┘
              │
              ▼
       Client Response
```

## PM2 Cluster Cache Internal Structure

```
┌───────────────────────────────────────────────────────────┐
│              PM2 Cluster Cache (per Worker)               │
│                Storage Mode: 'all' (Full Replication)     │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │       JavaScript Map (Built-in Data Structure)   │    │
│  │                                                   │    │
│  │  Key-Value Pairs (Synchronized across workers)   │    │
│  │    ↓                                              │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │ "id:507f1f77..."     → {value, metadata} │    │    │
│  │  │ "query:{...}"        → {value, metadata} │    │    │
│  │  │ "search:manuscript"  → {value, metadata} │    │    │
│  │  │ "history:507f1f77..." → {value, metadata} │    │    │
│  │  │ "since:507f1f77..."   → {value, metadata} │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  │                                                   │    │
│  │  Metadata per Entry:                             │    │
│  │  • value: Cached response data                   │    │
│  │  • timestamp: Creation time                      │    │
│  │  • ttl: Expiration time                          │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │         Eviction Strategy (Automatic)             │    │
│  │                                                   │    │
│  │  • maxLength: 1000 entries (enforced)            │    │
│  │  • When exceeded: Oldest entry removed           │    │
│  │  • TTL: Expired entries auto-removed             │    │
│  │  • Synchronized across all workers               │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │                 Statistics (Per Worker)           │    │
│  │        Aggregated every 5s across workers         │    │
│  │                                                   │    │
│  │  • hits: 1234        • length: 850/1000          │    │
│  │  • misses: 567       • bytes: 22.1MB (monitor)   │    │
│  │  • evictions: 89     • hitRate: 68.51%           │    │
│  │  • sets: 1801        • ttl: 86400000ms           │    │
│  └──────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

## Cache Key Patterns

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Cache Key Structure                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Type          │  Pattern                       │  Example                           │
│────────────────┼────────────────────────────────┼───────────────────────────────────│
│  ID            │  id:{object_id}                │  id:507f1f77bcf86cd799439         │
│  Query         │  query:{sorted_json}           │  query:{"limit":"100",...}        │
│  Search        │  search:{json}                 │  search:"manuscript"              │
│  Phrase        │  searchPhrase:{json}           │  searchPhrase:"medieval"          │
│  History       │  history:{id}                  │  history:507f1f77bcf86cd          │
│  Since         │  since:{id}                    │  since:507f1f77bcf86cd799         │
│  GOG Fragments │  gog-fragments:{id}:limit:skip │  gog-fragments:507f:limit=10:...  │
│  GOG Glosses   │  gog-glosses:{id}:limit:skip   │  gog-glosses:507f:limit=10:...    │
│                                                                         │
│  Note: All keys use consistent JSON.stringify() serialization          │
└────────────────────────────────────────────────────────────────────────┘
```

## Performance Metrics

```
┌──────────────────────────────────────────────────────────────┐
│                  Expected Performance                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Metric              │  Without Cache  │  With Cache (HIT)   │
│──────────────────────┼─────────────────┼────────────────────│
│  ID Lookup           │  50-200ms       │  1-5ms             │
│  Query               │  300-800ms      │  1-5ms             │
│  Search              │  200-800ms      │  2-10ms            │
│  History             │  150-600ms      │  1-5ms             │
│  Since               │  200-700ms      │  1-5ms             │
│                      │                 │                     │
│  Expected Hit Rate:  60-80% for read-heavy workloads        │
│  Speed Improvement:  60-800x for cached requests            │
│  Memory Usage:       ~26MB (1000 typical entries)           │
│  Database Load:      Reduced by hit rate percentage         │
└──────────────────────────────────────────────────────────────┘
```

## Limit Enforcement

The cache enforces both entry count and memory size limits:

```
┌──────────────────────────────────────────────────────────────┐
│                    Cache Limits (Dual)                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Limit Type     │  Default    │  Purpose                     │
│─────────────────┼─────────────┼──────────────────────────────│
│  Length (count) │  1000       │  Ensures cache diversity     │
│                 │             │  Prevents cache thrashing     │
│                 │             │  PRIMARY working limit        │
│                 │                                             │
│  Bytes (size)   │  1GB        │  Prevents memory exhaustion  │
│                 │             │  Safety net for edge cases   │
│                 │             │  Guards against huge objects │
│                                                               │
│  Balance: With typical RERUM queries (100 items/page),       │
│           1000 entries = ~26 MB (2.7% of 1GB limit)          │
│                                                               │
│  Typical entry sizes:                                        │
│    • ID lookup:        ~183 bytes                            │
│    • Query (10 items): ~2.7 KB                               │
│    • Query (100 items): ~27 KB                               │
│    • GOG (50 items):   ~13.5 KB                              │
│                                                               │
│  The length limit (1000) will be reached first in normal     │
│  operation. The byte limit provides protection against       │
│  accidentally caching very large result sets.                │
│                                                               │
│  Eviction: When maxLength (1000) is exceeded, PM2 Cluster    │
│           Cache automatically removes oldest entries across  │
│           all workers until limit is satisfied               │
└──────────────────────────────────────────────────────────────┘
```

## Invalidation Patterns

```
┌──────────────────────────────────────────────────────────────────┐
│              Smart Cache Invalidation Matrix                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Operation  │  Invalidates                                       │
│─────────────┼────────────────────────────────────────────────────│
│  CREATE     │  • Queries matching new object properties          │
│             │  • Searches matching new object content            │
│             │  • Preserves unrelated caches                      │
│             │                                                     │
│  UPDATE     │  • Specific object ID cache                        │
│  PATCH      │  • Queries matching updated properties             │
│             │  • Searches matching updated content               │
│             │  • History for: new ID + previous ID + prime ID    │
│             │  • Since for: new ID + previous ID + prime ID      │
│             │  • Preserves unrelated caches                      │
│             │                                                     │
│  DELETE     │  • Specific object ID cache                        │
│             │  • Queries matching deleted object (pre-deletion)  │
│             │  • Searches matching deleted object                │
│             │  • History for: deleted ID + previous ID + prime   │
│             │  • Since for: deleted ID + previous ID + prime     │
│             │  • Uses res.locals.deletedObject for properties    │
│             │                                                     │
│  RELEASE    │  • Everything (full invalidation)                  │
│             │                                                     │
│  Note: Version chain invalidation ensures history/since queries  │
│        for root objects are updated when descendants change      │
└──────────────────────────────────────────────────────────────────┘
```

## Configuration and Tuning

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Environment-Specific Settings                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Environment  │ MAX_LENGTH │ MAX_BYTES │  TTL                        │
│───────────────┼────────────┼───────────┼─────────────────────────────│
│  Development  │  500       │  500MB    │  300000 (5 min)             │
│  Staging      │  1000      │  1GB      │  300000 (5 min)             │
│  Production   │  1000      │  1GB      │  600000 (10 min)            │
│  High Traffic │  2000      │  2GB      │  300000 (5 min)             │
│                                                                       │
│  Recommendation: Keep defaults (1000 entries, 1GB) unless:           │
│    • Abundant memory available → Increase MAX_BYTES for safety       │
│    • Low cache hit rate → Increase MAX_LENGTH for diversity          │
│    • Memory constrained → Decrease both limits proportionally        │
└──────────────────────────────────────────────────────────────────────┘
```

---

**Legend:**
- `┌─┐` = Container boundaries
- `│` = Vertical flow/connection
- `▼` = Process direction
- `→` = Data flow
- `←→` = Bidirectional link
