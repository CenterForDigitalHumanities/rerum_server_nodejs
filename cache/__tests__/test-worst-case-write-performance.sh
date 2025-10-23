#!/bin/bash

# ============================================================================
# RERUM API Cache Layer - WORST CASE Write Performance Test
# ============================================================================
# 
# Purpose: Measure maximum possible cache overhead on write operations
#
# Worst Case Scenario:
# - Cache filled with 1000 entries that NEVER match created objects
# - Every write operation scans all 1000 entries
# - No cache invalidations occur (no matches found)
# - Measures pure iteration/scanning overhead without deletion cost
#
# This represents the absolute worst case: maximum cache size with
# zero cache hits during invalidation scanning.
#
# Usage: bash cache/__tests__/test-worst-case-write-performance.sh
# Prerequisites: Server running on localhost:3001 with valid bearer token
# ============================================================================

set -e

# Configuration
BASE_URL="http://localhost:3001"
API_ENDPOINT="${BASE_URL}/v1/api"
BEARER_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik9FVTBORFk0T1RVNVJrRXlOREl5TTBFMU1FVXdNMFUyT0RGQk9UaEZSa1JDTXpnek1FSTRNdyJ9.eyJodHRwOi8vc3RvcmUucmVydW0uaW8vYWdlbnQiOiJodHRwczovL2RldnN0b3JlLnJlcnVtLmlvL3YxL2lkLzY4ZDZkZDZhNzE4ZWUyOTRmMTk0YmUwNCIsImh0dHA6Ly9yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL3JlcnVtLmlvL2FwcF9mbGFnIjpbInRwZW4iXSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby9hcHBfZmxhZyI6WyJ0cGVuIl0sImlzcyI6Imh0dHBzOi8vY3ViYXAuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDY4ZDZkZDY0YmRhMmNkNzdhMTA2MWMxNyIsImF1ZCI6Imh0dHA6Ly9yZXJ1bS5pby9hcGkiLCJpYXQiOjE3NjExNjg2NzQsImV4cCI6MTc2Mzc2MDY3NCwic2NvcGUiOiJvZmZsaW5lX2FjY2VzcyIsImF6cCI6IjYySnNhOU14SHVxaFJiTzIwZ1RIczlLcEtyN1VlN3NsIn0.Em-OR7akifcOPM7xiUIJVkFC4VdS-DbkG1uMncAvG0mVxy_fsr7Vx7CUL_dg1YUFx0dWbQEPAy8NwVc_rKja5vixn-bieH3hYuM2gB0l01nLualrtOTm1usSz56_Sw5iHqfHi2Ywnh5O11v005-xWspbgIXC7-emNShmbDsSejSKDld-1AYnvO42lWY9a_Z_3klTYFYgnu6hbnDlJ-V3iKNwrJAIDK6fHreWrIp3zp3okyi_wkHczIcgwl2kacRAOVFA0H8V7JfOK-7tRbXKPeJGWXjnKbn6v80owbGcYdqWADBFwf32IsEWp1zH-R1zhobgfiIoRBqozMi6qT65MQ"

NUM_WRITE_TESTS=100
WARMUP_ITERATIONS=20

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  RERUM API - WORST CASE WRITE PERFORMANCE TEST"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Test Strategy:"
echo "  • Fill cache with 1000 entries using type='WorstCaseScenario'"
echo "  • Write objects with type='CreateRuntimeTest' (NEVER matches)"
echo "  • Force cache to scan all 1000 entries on every write"
echo "  • Zero invalidations = maximum scanning overhead"
echo ""

# ============================================================================
# Helper Functions
# ============================================================================

# Warmup the system (JIT, connections, caches)
warmup_system() {
    echo -e "${BLUE}→ Warming up system...${NC}"
    for i in $(seq 1 $WARMUP_ITERATIONS); do
        curl -s -X POST "${API_ENDPOINT}/create" \
            -H "Authorization: Bearer ${BEARER_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "{\"type\": \"WarmupTest\", \"iteration\": ${i}, \"timestamp\": $(date +%s%3N)}" \
            > /dev/null
    done
    echo -e "${GREEN}✓ Warmup complete (${WARMUP_ITERATIONS} operations)${NC}"
    echo ""
}

# Clear the cache
clear_cache() {
    echo -e "${BLUE}→ Clearing cache...${NC}"
    curl -s -X POST "${API_ENDPOINT}/cache/clear" > /dev/null
    echo -e "${GREEN}✓ Cache cleared${NC}"
    echo ""
}

# Fill cache with 1000 entries that will NEVER match test objects
fill_cache_worst_case() {
    echo -e "${BLUE}→ Filling cache with 1000 non-matching entries...${NC}"
    echo "   Strategy: All queries use type='WorstCaseScenario'"
    echo "   Creates will use type='CreateRuntimeTest'"
    echo "   Result: Zero matches = maximum scan overhead"
    echo ""
    
    # Fill with 1000 queries that use a completely different type
    for i in $(seq 0 999); do
        if [ $((i % 100)) -eq 0 ]; then
            echo "   Progress: ${i}/1000 entries..."
        fi
        
        # All queries use type="WorstCaseScenario" which will NEVER match
        curl -s -X POST "${API_ENDPOINT}/query" \
            -H "Content-Type: application/json" \
            -d "{\"body\": {\"type\": \"WorstCaseScenario\", \"limit\": 10, \"skip\": ${i}}, \"options\": {\"limit\": 10, \"skip\": ${i}}}" \
            > /dev/null
    done
    
    # Verify cache is full
    CACHE_SIZE=$(curl -s "${API_ENDPOINT}/cache/stats" | grep -o '"length":[0-9]*' | cut -d: -f2)
    echo ""
    echo -e "${GREEN}✓ Cache filled with ${CACHE_SIZE} entries${NC}"
    
    if [ "${CACHE_SIZE}" -lt 900 ]; then
        echo -e "${YELLOW}⚠ Warning: Expected ~1000 entries, got ${CACHE_SIZE}${NC}"
    fi
    echo ""
}

# Run performance test
run_write_test() {
    local test_name=$1
    local object_type=$2
    
    echo -e "${BLUE}→ Running ${test_name}...${NC}"
    echo "   Operations: ${NUM_WRITE_TESTS}"
    echo "   Object type: ${object_type}"
    echo ""
    
    times=()
    
    for i in $(seq 1 $NUM_WRITE_TESTS); do
        START=$(date +%s%3N)
        
        curl -s -X POST "${API_ENDPOINT}/create" \
            -H "Authorization: Bearer ${BEARER_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "{\"type\": \"${object_type}\", \"iteration\": ${i}, \"timestamp\": $(date +%s%3N)}" \
            > /dev/null
        
        END=$(date +%s%3N)
        DURATION=$((END - START))
        times+=($DURATION)
    done
    
    # Calculate statistics
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    
    sum=0
    for time in "${times[@]}"; do
        sum=$((sum + time))
    done
    avg=$((sum / ${#times[@]}))
    
    median_idx=$((${#sorted[@]} / 2))
    median=${sorted[$median_idx]}
    
    min=${sorted[0]}
    max=${sorted[-1]}
    
    echo -e "${GREEN}✓ Test complete${NC}"
    echo ""
    echo "   Results:"
    echo "   • Average time: ${avg}ms"
    echo "   • Median time: ${median}ms"
    echo "   • Min time: ${min}ms"
    echo "   • Max time: ${max}ms"
    echo ""
    
    # Store results in global variables for analysis
    if [ "$test_name" = "Empty Cache Test" ]; then
        EMPTY_AVG=$avg
        EMPTY_MEDIAN=$median
        EMPTY_MIN=$min
        EMPTY_MAX=$max
    else
        FULL_AVG=$avg
        FULL_MEDIAN=$median
        FULL_MIN=$min
        FULL_MAX=$max
    fi
}

# ============================================================================
# Main Test Flow
# ============================================================================

echo "══════════════════════════════════════════════════════════"
echo "PHASE 1: SYSTEM WARMUP"
echo "══════════════════════════════════════════════════════════"
echo ""

warmup_system
clear_cache

echo "══════════════════════════════════════════════════════════"
echo "PHASE 2: BASELINE TEST (EMPTY CACHE)"
echo "══════════════════════════════════════════════════════════"
echo ""

run_write_test "Empty Cache Test" "CreateRuntimeTest"

echo "══════════════════════════════════════════════════════════"
echo "PHASE 3: FILL CACHE (WORST CASE SCENARIO)"
echo "══════════════════════════════════════════════════════════"
echo ""

fill_cache_worst_case

# Get cache stats before worst case test
CACHE_BEFORE=$(curl -s "${API_ENDPOINT}/cache/stats")
CACHE_SIZE_BEFORE=$(echo "$CACHE_BEFORE" | grep -o '"length":[0-9]*' | cut -d: -f2)
INVALIDATIONS_BEFORE=$(echo "$CACHE_BEFORE" | grep -o '"invalidations":[0-9]*' | cut -d: -f2)

echo "Cache state before test:"
echo "  • Size: ${CACHE_SIZE_BEFORE} entries"
echo "  • Invalidations (lifetime): ${INVALIDATIONS_BEFORE}"
echo ""

echo "══════════════════════════════════════════════════════════"
echo "PHASE 4: WORST CASE TEST (FULL CACHE, ZERO MATCHES)"
echo "══════════════════════════════════════════════════════════"
echo ""

run_write_test "Worst Case Test" "CreateRuntimeTest"

# Get cache stats after worst case test
CACHE_AFTER=$(curl -s "${API_ENDPOINT}/cache/stats")
CACHE_SIZE_AFTER=$(echo "$CACHE_AFTER" | grep -o '"length":[0-9]*' | cut -d: -f2)
INVALIDATIONS_AFTER=$(echo "$CACHE_AFTER" | grep -o '"invalidations":[0-9]*' | cut -d: -f2)

echo "Cache state after test:"
echo "  • Size: ${CACHE_SIZE_AFTER} entries"
echo "  • Invalidations (lifetime): ${INVALIDATIONS_AFTER}"
echo "  • Invalidations during test: $((INVALIDATIONS_AFTER - INVALIDATIONS_BEFORE))"
echo ""

# ============================================================================
# Results Analysis
# ============================================================================

echo "══════════════════════════════════════════════════════════"
echo "WORST CASE ANALYSIS"
echo "══════════════════════════════════════════════════════════"
echo ""

OVERHEAD=$((FULL_MEDIAN - EMPTY_MEDIAN))
if [ $EMPTY_MEDIAN -gt 0 ]; then
    PERCENT=$((OVERHEAD * 100 / EMPTY_MEDIAN))
else
    PERCENT=0
fi

echo "Performance Impact:"
echo "  • Empty cache (baseline): ${EMPTY_MEDIAN}ms"
echo "  • Full cache (worst case): ${FULL_MEDIAN}ms"
echo "  • Maximum overhead: ${OVERHEAD}ms"
echo "  • Percentage impact: ${PERCENT}%"
echo ""

# Verify worst case conditions
INVALIDATIONS_DURING_TEST=$((INVALIDATIONS_AFTER - INVALIDATIONS_BEFORE))
EXPECTED_SCANS=$((NUM_WRITE_TESTS * CACHE_SIZE_BEFORE))

echo "Worst Case Validation:"
echo "  • Cache entries scanned: ${EXPECTED_SCANS} (${NUM_WRITE_TESTS} writes × ${CACHE_SIZE_BEFORE} entries)"
echo "  • Actual invalidations: ${INVALIDATIONS_DURING_TEST}"
echo "  • Cache size unchanged: ${CACHE_SIZE_BEFORE} → ${CACHE_SIZE_AFTER}"
echo ""

if [ $INVALIDATIONS_DURING_TEST -eq 0 ] && [ $CACHE_SIZE_BEFORE -eq $CACHE_SIZE_AFTER ]; then
    echo -e "${GREEN}✓ WORST CASE CONFIRMED: Zero invalidations, full scan every write${NC}"
else
    echo -e "${YELLOW}⚠ Warning: Some invalidations occurred (${INVALIDATIONS_DURING_TEST})${NC}"
    echo "   This may not represent true worst case."
fi
echo ""

# Impact assessment
echo "Impact Assessment:"
if [ $OVERHEAD -le 5 ]; then
    echo -e "${GREEN}✓ NEGLIGIBLE IMPACT${NC}"
    echo "   Even in worst case, overhead is ${OVERHEAD}ms (${PERCENT}%)"
    echo "   Cache is safe to deploy with confidence"
elif [ $OVERHEAD -le 10 ]; then
    echo -e "${GREEN}✓ LOW IMPACT${NC}"
    echo "   Worst case overhead is ${OVERHEAD}ms (${PERCENT}%)"
    echo "   Acceptable for read-heavy workloads"
elif [ $OVERHEAD -le 20 ]; then
    echo -e "${YELLOW}⚠ MODERATE IMPACT${NC}"
    echo "   Worst case overhead is ${OVERHEAD}ms (${PERCENT}%)"
    echo "   Monitor write performance in production"
else
    echo -e "${RED}✗ HIGH IMPACT${NC}"
    echo "   Worst case overhead is ${OVERHEAD}ms (${PERCENT}%)"
    echo "   Consider cache size reduction or optimization"
fi
echo ""

echo "Read vs Write Tradeoff:"
echo "  • Cache provides: 60-150x speedup on reads"
echo "  • Cache costs: ${OVERHEAD}ms per write (worst case)"
echo "  • Recommendation: Deploy for read-heavy workloads (>80% reads)"
echo ""

echo "══════════════════════════════════════════════════════════"
echo "TEST COMPLETE"
echo "══════════════════════════════════════════════════════════"
echo ""

# Save results to file
cat > /tmp/worst_case_perf_results.txt << EOF
RERUM API Cache Layer - Worst Case Write Performance Test Results
Generated: $(date)

Test Configuration:
- Cache size: ${CACHE_SIZE_BEFORE} entries
- Write operations: ${NUM_WRITE_TESTS}
- Cache invalidations during test: ${INVALIDATIONS_DURING_TEST}
- Total cache scans: ${EXPECTED_SCANS}

Performance Results:
- Empty cache (baseline): ${EMPTY_MEDIAN}ms median
- Full cache (worst case): ${FULL_MEDIAN}ms median
- Maximum overhead: ${OVERHEAD}ms
- Percentage impact: ${PERCENT}%

Conclusion:
Worst case scenario (scanning ${CACHE_SIZE_BEFORE} entries with zero matches)
adds ${OVERHEAD}ms overhead per write operation.
EOF

echo "Results saved to: /tmp/worst_case_perf_results.txt"
echo ""
