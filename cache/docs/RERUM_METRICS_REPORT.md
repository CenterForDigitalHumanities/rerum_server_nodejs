# RERUM Baseline Performance Analysis (No Cache)

**Generated**: Wed Nov  5 14:07:17 CST 2025
**Server**: https://devstore.rerum.io
**Branch**: main (no cache layer)
**Test Duration**: 4 minutes 27 seconds

---

## Executive Summary

**Overall Test Results**: 18 passed, 0 failed, 0 skipped (18 total)

This report establishes baseline performance metrics for the RERUM API without the cache layer. These metrics can be compared against CACHE_METRICS_REPORT.md to evaluate the impact of the caching implementation.

---

## Endpoint Functionality Status

| Endpoint | Status | Description |
|----------|--------|-------------|
| `/query` | ✅ Functional | Query database with filters |
| `/search` | ✅ Functional | Full-text search |
| `/searchPhrase` | ✅ Functional | Phrase search |
| `/id` | ✅ Functional | Retrieve object by ID |
| `/history` | ✅ Functional | Get version history |
| `/since` | ✅ Functional | Get version descendants |
| `/create` | ✅ Functional | Create new objects |
| `/update` | ✅ Functional | Update existing objects |
| `/patch` | ✅ Functional | Patch existing objects |
| `/set` | ✅ Functional | Add properties to objects |
| `/unset` | ✅ Functional | Remove properties from objects |
| `/delete` | ✅ Functional | Delete objects |
| `/overwrite` | ✅ Functional | Overwrite objects without versioning |

---

## Read Performance

| Endpoint | Avg (ms) | Median (ms) | Min (ms) | Max (ms) |
|----------|----------|-------------|----------|----------|
| `/query` | 455 | 455 | 455 | 455 |
| `/search` | 402 | 402 | 402 | 402 |
| `/searchPhrase` | 394 | 394 | 394 | 394 |
| `/id` | 528 | 528 | 528 | 528 |
| `/history` | 853 | 853 | 853 | 853 |
| `/since` | 872 | 872 | 872 | 872 |

**Interpretation**:
- All read operations hit the database directly (no caching)
- Times represent baseline database query performance
- These metrics can be compared with cached read performance to calculate cache speedup

---

## High-Volume Query Load Test

This test performs 1000 diverse read queries to measure baseline database performance under load. It directly corresponds to the `fill_cache()` operation in cache-metrics.sh, enabling direct comparison.

| Metric | Value |
|--------|-------|
| Total Queries | 1000 |
| Total Time | 24 seconds (24000ms) |
| Average per Query | 24ms |
| Successful Queries | 1000/1000 |
| Failed Queries | 0/1000 |

**Query Distribution**:
- Rotates through 6 endpoint types: /api/query, /api/search, /api/search/phrase, /id/{id}, /history/{id}, /since/{id}
- Each query uses unique parameters to prevent database-level caching

**Comparison with Cache**:
- Compare this total time with the cache fill operation time in CACHE_METRICS_REPORT.md
- This shows baseline database performance for 1000 diverse queries without caching
- Cache fill time includes both database queries (on cache misses) and cache.set() operations

---

## Write Performance

| Endpoint | Avg (ms) | Median (ms) | Min (ms) | Max (ms) | Successful/Total |
|----------|----------|-------------|----------|----------|------------------|
| `/create` | 153 | 143 | 125 | 1169 | 100/100 |
| `/update` | 677 | 643 | 622 | 1666 | 50/50 |
| `/patch` | 642 | 641 | 619 | 682 | 50/50 |
| `/set` | 648 | 638 | 612 | 1174 | 50/50 |
| `/unset` | 656 | 645 | 618 | 1144 | 50/50 |
| `/delete` | 567 | 568 | 546 | 598 | 50/50 |
| `/overwrite` | 604 | 604 | 582 | 648 | 50/50 |

**Interpretation**:
- All write operations execute without cache invalidation overhead
- Times represent baseline write performance
- These metrics can be compared with cached write performance to calculate cache overhead

---

## Summary Statistics

**Total Operations**:
- Read operations: 6 endpoints tested
- Write operations: 400 operations across 7 endpoints

**Success Rates**:
- Create: 100/100
- Update: 50/50
- Patch: 50/50
- Set: 50/50
- Unset: 50/50
- Delete: 50/50
- Overwrite: 50/50

**Test Execution**:
- Total duration: 4 minutes 27 seconds
- Test objects created: 100
- Server: https://devstore.rerum.io

---

## Comparison Guide

To compare with cache performance (CACHE_METRICS_REPORT.md):

1. **Read Speedup**: Calculate cache benefit
   ```
   Speedup = Baseline Read Time - Cached Read Time
   Speedup % = (Speedup / Baseline Read Time) × 100
   ```

2. **Write Overhead**: Calculate cache cost
   ```
   Overhead = Cached Write Time - Baseline Write Time
   Overhead % = (Overhead / Baseline Write Time) × 100
   ```

3. **Net Benefit**: Evaluate overall impact based on your read/write ratio

---

## Notes

- This test was run against the **main branch** without the cache layer
- All timing measurements are in milliseconds
- Clock skew was handled gracefully (operations with negative timing marked as 0ms)
- Test objects should be manually cleaned from MongoDB using the commands provided at test start

---

**Report Generated**: Wed Nov  5 14:07:17 CST 2025
**Format Version**: 1.0
**Test Suite**: rerum-metrics.sh
