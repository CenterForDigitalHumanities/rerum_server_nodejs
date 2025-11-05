# RERUM Baseline Performance Analysis (No Cache)

**Generated**: Wed Nov  5 12:31:45 CST 2025
**Server**: https://devstore.rerum.io
**Branch**: main (no cache layer)
**Test Duration**: 4 minutes 41 seconds

---

## Executive Summary

**Overall Test Results**: 17 passed, 0 failed, 0 skipped (17 total)

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
| `/query` | 453 | 453 | 453 | 453 |
| `/search` | 151 | 151 | 151 | 151 |
| `/searchPhrase` | 136 | 136 | 136 | 136 |
| `/id` | 530 | 530 | 530 | 530 |
| `/history` | 852 | 852 | 852 | 852 |
| `/since` | 864 | 864 | 864 | 864 |

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
| Total Time | 66 seconds (66000ms) |
| Average per Query | 66ms |
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
| `/create` | 151 | 140 | 127 | 1195 | 100/100 |
| `/update` | 587 | 566 | 547 | 1561 | 50/50 |
| `/patch` | 568 | 567 | 547 | 618 | 50/50 |
| `/set` | 597 | 570 | 542 | 1079 | 50/50 |
| `/unset` | 572 | 566 | 543 | 710 | 50/50 |
| `/delete` | 565 | 565 | 546 | 604 | 50/50 |
| `/overwrite` | 567 | 568 | 550 | 594 | 50/50 |

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
- Total duration: 4 minutes 41 seconds
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

**Report Generated**: Wed Nov  5 12:31:45 CST 2025
**Format Version**: 1.0
**Test Suite**: rerum-metrics.sh
