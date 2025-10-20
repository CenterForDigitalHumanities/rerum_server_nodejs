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
│     │   LRU Cache       │          │                            │
│     │   (In-Memory)     │          │                            │
│     │                   │          │                            │
│     │  Max: 1000 items  │          │                            │
│     │  TTL: 5 minutes   │          │                            │
│     │  Eviction: LRU    │          │                            │
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

## LRU Cache Internal Structure

```
┌───────────────────────────────────────────────────────────┐
│                     LRU Cache                              │
│                                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │          Doubly Linked List (Access Order)       │    │
│  │                                                   │    │
│  │  HEAD (Most Recent)                               │    │
│  │    ↓                                              │    │
│  │  ┌─────────────┐     ┌─────────────┐            │    │
│  │  │   Node 1    │ ←→  │   Node 2    │            │    │
│  │  │ key: "id:1" │     │ key: "qry:1"│            │    │
│  │  │ value: {...}│     │ value: [...] │            │    │
│  │  │ hits: 15    │     │ hits: 8     │            │    │
│  │  │ age: 30s    │     │ age: 45s    │            │    │
│  │  └──────┬──────┘     └──────┬──────┘            │    │
│  │         ↓                   ↓                    │    │
│  │  ┌─────────────┐     ┌─────────────┐            │    │
│  │  │   Node 3    │ ←→  │   Node 4    │            │    │
│  │  │ key: "sch:1"│     │ key: "his:1"│            │    │
│  │  └─────────────┘     └─────────────┘            │    │
│  │         ↓                                        │    │
│  │       TAIL (Least Recent - Next to Evict)       │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │              Hash Map (Fast Lookup)              │    │
│  │                                                   │    │
│  │  "id:1"    → Node 1                              │    │
│  │  "qry:1"   → Node 2                              │    │
│  │  "sch:1"   → Node 3                              │    │
│  │  "his:1"   → Node 4                              │    │
│  │  ...                                             │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │                 Statistics                        │    │
│  │                                                   │    │
│  │  • hits: 1234        • size: 850/1000            │    │
│  │  • misses: 567       • hitRate: 68.51%           │    │
│  │  • evictions: 89     • ttl: 300000ms             │    │
│  │  • sets: 1801        • invalidations: 45         │    │
│  └──────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

## Cache Key Patterns

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Cache Key Structure                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Type          │  Pattern                │  Example                    │
│────────────────┼─────────────────────────┼────────────────────────────│
│  ID            │  id:{object_id}         │  id:507f1f77bcf86cd799439  │
│  Query         │  query:{sorted_json}    │  query:{"limit":"100",...} │
│  Search        │  search:{json}          │  search:"manuscript"       │
│  Phrase        │  searchPhrase:{json}    │  searchPhrase:"medieval"   │
│  History       │  history:{id}           │  history:507f1f77bcf86cd   │
│  Since         │  since:{id}             │  since:507f1f77bcf86cd799  │
│  GOG Fragments │  gogFragments:{uri}:... │  gogFragments:https://...  │
│  GOG Glosses   │  gogGlosses:{uri}:...   │  gogGlosses:https://...    │
│                                                                         │
│  Note: ID, history, and since keys use simple concatenation (no quotes)│
│        Query and search keys use JSON.stringify with sorted properties │
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
│  Memory Usage:       ~2-10MB (1000 entries @ 2-10KB each)   │
│  Database Load:      Reduced by hit rate percentage         │
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
┌──────────────────────────────────────────────────────────┐
│               Environment-Specific Settings               │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Environment   │  CACHE_MAX_SIZE  │  CACHE_TTL          │
│────────────────┼──────────────────┼─────────────────────│
│  Development   │  500             │  300000 (5 min)     │
│  Staging       │  1000            │  300000 (5 min)     │
│  Production    │  2000-5000       │  600000 (10 min)    │
│  High Traffic  │  5000+           │  300000 (5 min)     │
└──────────────────────────────────────────────────────────┘
```

---

**Legend:**
- `┌─┐` = Container boundaries
- `│` = Vertical flow/connection
- `▼` = Process direction
- `→` = Data flow
- `←→` = Bidirectional link
