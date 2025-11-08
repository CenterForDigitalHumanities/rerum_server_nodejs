#!/bin/bash

# ==============================================================================
# RERUM API Cache Invalidation Race Condition Test
# ==============================================================================
#
# REFERENCE: See .claude/CACHE_LAYER_RESEARCH.md for complete analysis
#
# PURPOSE:
# This script is THE DEFINITIVE TEST for cache consistency in PM2 cluster mode.
# It detects race conditions where stale cached data is returned immediately
# after write operations due to asynchronous cross-worker cache invalidation.
#
# WHY THIS TEST EXISTS:
# Other tests (cache.test.js, cache-limits.test.js, cache-metrics.sh) did NOT
# detect the race condition because they:
# - Test single workers in isolation
# - Don't simulate rapid write→read user patterns
# - Measure metrics, not data correctness
# - Don't test cross-worker synchronization
#
# This test simulates REAL USER BEHAVIOR: updating an object and immediately
# re-querying it. With PM2's round-robin load balancing, the write hits Worker A
# and the read hits Worker B, exposing async invalidation issues.
#
# THE RACE CONDITION EXPLAINED:
#
# Timeline (PM2 cluster with 4 workers):
#   T+0ms   : Client sends PUT /api/overwrite
#   T+1ms   : Worker A receives request
#   T+10ms  : Worker A updates MongoDB ✓
#   T+12ms  : Worker A calls cache.delete() → sends IPC to Workers B/C/D
#   T+14ms  : cache.delete() Promise resolves (IPC SENT, not PROCESSED) ✗
#   T+15ms  : Worker A sends HTTP 200 OK to client
#   T+20ms  : Client receives 200 OK, immediately sends GET /id/{id}
#   T+21ms  : Worker B receives GET request
#   T+22ms  : Worker B reads cache → STALE DATA ✗ (IPC not processed yet)
#   T+150ms : Worker B finally processes IPC and deletes cache (too late)
#
# ROOT CAUSE:
# pm2-cluster-cache uses "fire-and-forget" IPC. The delete() Promise resolves
# immediately after SENDING messages to other workers, NOT after they PROCESS
# them. Source: node_modules/pm2-cluster-cache/lib/ClusterCache.js:158-180
#
# IPC timing: 50-200ms (sometimes >3 seconds under load)
# User timing: Write then read in 0-100ms
# Gap = Guaranteed stale data
#
# TEST METHODOLOGY:
# 1. Clear cache (clean start)
# 2. Initialize test object with 2 items, cache it
# 3. Run 30 rapid write→read cycles:
#    - Cycle through 0, 1, or 3 items
#    - PUT /overwrite (Worker A)
#    - GET /id/{id} IMMEDIATELY (Worker B, likely)
#    - Compare expected vs actual item count
# 4. Report: Fresh data % vs Stale data %
#
# SUCCESS CRITERIA:
# ✓ Fresh data: 30 (100%), Stale data: 0 (0%)
# ✗ ANY stale data detected = FAILURE
#
# EXPECTED RESULTS BY IMPLEMENTATION:
# - pm2-cluster-cache:  83% stale ✗ (async IPC)
# - Redis:               0% stale ✓ (atomic operations)
# - Memcached:           0% stale ✓ (atomic operations)
# - No cache:            0% stale ✓ (always fresh from DB)
# - ANY new solution:    MUST BE 0% stale
#
# USAGE FOR NEW IMPLEMENTATIONS:
# When testing a new cache solution (Redis, Memcached, etc.):
#
# 1. Update TOKEN (line 98) with fresh Auth0 JWT
# 2. Ensure PM2 cluster running: pm2 list (should show 4 workers)
# 3. Verify test object exists:
#    curl http://localhost:3001/v1/id/690e93a7330943df44315d50
# 4. Run test: bash race-condition.sh
# 5. Check results:
#    - PASS: "Fresh data: 30 (100%)"
#    - FAIL: Any "Stale data" detected
#
# If ANY stale data appears, the implementation violates the absolute
# requirement: "Cache must NEVER return stale data"
#
# ==============================================================================

# Configuration
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik9FVTBORFk0T1RVNVJrRXlOREl5TTBFMU1FVXdNMFUyT0RGQk9UaEZSa1JDTXpnek1FSTRNdyJ9.eyJodHRwOi8vc3RvcmUucmVydW0uaW8vYWdlbnQiOiJodHRwczovL2RldnN0b3JlLnJlcnVtLmlvL3YxL2lkLzY4ZDZkZDZhNzE4ZWUyOTRmMTk0YmUwNCIsImh0dHA6Ly9yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL3JlcnVtLmlvL2FwcF9mbGFnIjpbInRwZW4iXSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby9hcHBfZmxhZyI6WyJ0cGVuIl0sImlzcyI6Imh0dHBzOi8vY3ViYXAuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDY4ZDZkZDY0YmRhMmNkNzdhMTA2MWMxNyIsImF1ZCI6Imh0dHA6Ly9yZXJ1bS5pby9hcGkiLCJpYXQiOjE3NjI1NzczMDEsImV4cCI6MTc2NTE2OTMwMSwic2NvcGUiOiJvZmZsaW5lX2FjY2VzcyIsImF6cCI6IjYySnNhOU14SHVxaFJiTzIwZ1RIczlLcEtyN1VlN3NsIn0.uYXAxjlzsaAyju6eKxbhx-gv4oSawv89jrnPcT0ngX8HL2Hfd91D-MNrdAVRu4xwwcU56wz5cery_dyC781HZEzaxvJNVciNoMMUP41AXPjE7C2G2fIZRcgqckhSp_1v-tsimqSx57Obk79Cnu7Xwte0ghM0fwnHE5rhLrdPWW2ytakRxKKPq1m-6Vms5QNbYP8jiXNAVXg2t0XOVA-V8BOB6Hk2qeoUJYAvmxoCLxn79vgqVIFOgHNax1zB75nNOphROPDvqBo52S7SIX-F0pPzz48c6tboacUHiLWNrpUlsRABcTlmvMUW_yQ7ioQKkVArY987ZoiOaCpkZ2ioqw"

# Test object ID (you may need to update this if the object doesn't exist)
URL="http://localhost:3001/v1/id/690e93a7330943df44315d50"
API_URL="http://localhost:3001/v1/api/overwrite"
CLEAR_URL="http://localhost:3001/v1/api/cache/clear"
STATS_URL="http://localhost:3001/v1/api/cache/stats"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

print_header() {
    echo ""
    echo "=============================================================="
    echo "$1"
    echo "=============================================================="
}

print_section() {
    echo ""
    echo ">>> $1"
    echo "--------------------------------------------------------------"
}

# ==============================================================================
# MAIN TEST SCRIPT
# ==============================================================================

clear
echo -e "${BOLD}RERUM API CACHE INVALIDATION RACE CONDITION TEST${NC}"
echo "Date: $(date)"
echo ""

# Step 1: Clear cache and verify it's empty
print_section "Step 1: Clearing cache and verifying"

echo "Clearing cache..."
response=$(curl -X POST "$CLEAR_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -s -w "\nHTTP_STATUS:%{http_code}")

http_status=$(echo "$response" | grep "HTTP_STATUS" | cut -d':' -f2)
if [ "$http_status" = "200" ]; then
    echo -e "${GREEN}✓ Cache cleared successfully${NC}"
else
    echo -e "${RED}✗ Failed to clear cache (HTTP $http_status)${NC}"
    exit 1
fi

# Verify cache is empty (quick check without details to avoid 6-second delay)
echo "Verifying cache is empty..."
cache_length=$(curl -s "$STATS_URL" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('length', -1))" 2>/dev/null)

if [ "$cache_length" = "0" ]; then
    echo -e "${GREEN}✓ Cache verified empty (0 entries)${NC}"
elif [ "$cache_length" = "-1" ]; then
    echo -e "${YELLOW}⚠ Could not verify cache status${NC}"
else
    echo -e "${YELLOW}⚠ Cache has $cache_length entries (expected 0)${NC}"
fi

# Step 2: Initialize test object
print_section "Step 2: Initializing test object"

echo "Setting initial state: AnnotationPage with 2 items..."
curl -X PUT "$API_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"@id": "'"$URL"'", "type": "AnnotationPage", "items": [{"type": "Annotation", "bodyValue": "initial1"}, {"type": "Annotation", "bodyValue": "initial2"}]}' \
    -s -o /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Initial object created/updated${NC}"
else
    echo -e "${RED}✗ Failed to create initial object${NC}"
    exit 1
fi

# Cache it by doing a GET
echo "Caching the object..."
curl -s "$URL" -o /dev/null
echo -e "${GREEN}✓ Object cached with 2 items${NC}"

# Step 3: Demonstrate the race condition
print_section "Step 3: Demonstrating Race Condition"

echo "This test will rapidly alternate between different item counts"
echo "and check if the GET immediately after PUT returns fresh data."
echo ""

# Initialize counters
total=0
success=0
failures=0

# Test pattern explanation
echo -e "${BOLD}Test Pattern:${NC}"
echo "  1. PUT /api/overwrite with N items"
echo "  2. Immediately GET /id/{id}"
echo "  3. Check if returned items match what was just set"
echo ""
echo "Starting rapid test sequence..."
echo ""

# Run the test sequence
for i in {1..30}; do
    # Determine what to set (cycle through 0, 1, 3 items)
    case $((i % 3)) in
        0)
            expected=0
            items='[]'
            desc="empty"
            ;;
        1)
            expected=1
            items='[{"type": "Annotation", "bodyValue": "single"}]'
            desc="one"
            ;;
        2)
            expected=3
            items='[{"type": "Annotation", "bodyValue": "a"}, {"type": "Annotation", "bodyValue": "b"}, {"type": "Annotation", "bodyValue": "c"}]'
            desc="three"
            ;;
    esac

    # Overwrite and immediately GET (this is the critical test)
    # The && ensures GET happens immediately after PUT completes
    curl -X PUT "$API_URL" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"@id\": \"$URL\", \"type\": \"AnnotationPage\", \"items\": $items}" \
        -s -o /dev/null && \
    actual=$(curl -s "$URL" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data.get('items', [])))" 2>/dev/null)

    ((total++))

    # Check if we got fresh or stale data
    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}✓${NC} Test $i: Set $desc($expected) → Got $actual - FRESH DATA"
        ((success++))
    else
        echo -e "  ${RED}✗${NC} Test $i: Set $desc($expected) → Got $actual - ${RED}STALE DATA (Race Condition!)${NC}"
        ((failures++))
    fi
done

# Step 4: Results Analysis
print_header "TEST RESULTS & ANALYSIS"

echo -e "${BOLD}Statistics:${NC}"
echo "  Total tests:    $total"
echo -e "  ${GREEN}Fresh data:     $success ($(( success * 100 / total ))%)${NC}"
echo -e "  ${RED}Stale data:     $failures ($(( failures * 100 / total ))%)${NC}"
echo ""

if [ $failures -gt 0 ]; then
    echo -e "${RED}${BOLD}⚠️  RACE CONDITION CONFIRMED${NC}"
    echo ""
    echo "The test shows that in $(( failures * 100 / total ))% of cases, the GET request"
    echo "returns stale cached data immediately after an overwrite operation."
    echo ""
    echo -e "${BOLD}Why this happens:${NC}"
    echo "1. PUT /api/overwrite updates MongoDB and sends 200 OK"
    echo "2. Cache invalidation runs asynchronously (fire-and-forget)"
    echo "3. Client's immediate GET hits the old cached data"
    echo "4. Cache invalidation completes 50-200ms later"
    echo ""
    echo -e "${BOLD}Impact:${NC}"
    echo "- Users see stale data for 6-10 seconds after updates"
    echo "- Affects all write operations (create, update, delete, overwrite)"
    echo "- Worse in PM2 cluster mode due to IPC delays"
    echo ""
    echo -e "${BOLD}Solution Options:${NC}"
    echo "1. Make cache invalidation synchronous (await before sending response)"
    echo "2. Invalidate ID cache specifically before other caches"
    echo "3. Use post-response invalidation with res.on('finish')"
    echo "4. Reduce browser cache headers (Cache-Control: no-cache)"
else
    echo -e "${GREEN}${BOLD}✓ All tests passed!${NC}"
    echo "Cache invalidation appears to be working correctly."
    echo "No race conditions detected."
fi

# Optional: Check final cache state (adds 6-second delay)
echo ""
read -p "Check detailed cache state? (takes ~6 seconds) [y/N]: " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_section "Final Cache State"
    echo "Fetching cache details..."
    cache_info=$(curl -s "$STATS_URL?details=true")

    # Parse and display cache info
    echo "$cache_info" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'Cache entries: {data.get(\"length\", 0)}')
print(f'Hit rate: {data.get(\"hitRate\", \"N/A\")}')
if 'details' in data and data['details']:
    for entry in data['details']:
        if '690e93a7330943df44315d50' in entry.get('key', ''):
            print(f'Our test object is cached: {entry.get(\"key\")}')
            break
    "
fi

echo ""
echo "=============================================================="
echo "Test completed at $(date +%H:%M:%S)"
echo "=============================================================="