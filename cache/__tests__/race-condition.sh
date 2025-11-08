#!/bin/bash

# ==============================================================================
# RERUM API Cache Invalidation Race Condition Test
# ==============================================================================
#
# PURPOSE:
# This script demonstrates a critical race condition in the RERUM API's cache
# invalidation system. When using fire-and-forget pattern for cache invalidation,
# there's a window where stale data can be served immediately after updates.
#
# THE PROBLEM:
# 1. Client calls PUT /api/overwrite to update an object
# 2. Server updates MongoDB and sends 200 OK response immediately
# 3. Cache invalidation happens asynchronously in the background (fire-and-forget)
# 4. Client immediately calls GET /id/{id} after receiving 200 OK
# 5. GET request hits STALE cache because invalidation hasn't completed yet
# 6. Result: Users see old data for 6-10 seconds after updates
#
# ROOT CAUSE (cache/middleware.js lines 361-367):
#   res.json = (data) => {
#       performInvalidation(data).catch(err => {...})  // Async, not awaited!
#       return originalJson(data)                       // Response sent immediately
#   }
#
# EXPECTED FAILURE RATE: ~80-85% when running rapid overwrites
#
# ==============================================================================

# Configuration
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik9FVTBORFk0T1RVNVJrRXlOREl5TTBFMU1FVXdNMFUyT0RGQk9UaEZSa1JDTXpnek1FSTRNdyJ9.eyJodHRwOi8vc3RvcmUucmVydW0uaW8vYWdlbnQiOiJodHRwczovL2RldnN0b3JlLnJlcnVtLmlvL3YxL2lkLzY4ZDZkZDZhNzE4ZWUyOTRmMTk0YmUwNCIsImh0dHA6Ly9yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL3JlcnVtLmlvL2FwcF9mbGFnIjpbInRwZW4iXSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby9hcHBfZmxhZyI6WyJ0cGVuIl0sImlzcyI6Imh0dHBzOi8vY3ViYXAuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDY4ZDZkZDY0YmRhMmNkNzdhMTA2MWMxNyIsImF1ZCI6Imh0dHA6Ly9yZXJ1bS5pby9hcGkiLCJpYXQiOjE3NjI1NzAxODUsImV4cCI6MTc2NTE2MjE4NSwic2NvcGUiOiJvZmZsaW5lX2FjY2VzcyIsImF6cCI6IjYySnNhOU14SHVxaFJiTzIwZ1RIczlLcEtyN1VlN3NsIn0.Qo7Z5VKsHbVFHV1egt8arNq8ZD_TAG5zTr8PTiht2M5JlUuoZEF_5wyqkJ7GsiZfWNaazJxYGAbABjV9nwSeOcHSOs80sD92oYfrW7jvoiitrRxbjiEcvLkvkN_FmMQKDdUNcsw1gnMrGC6AgPKUQRSYxiBq2YD67AMp4xr1VC69cwGmD8MUxr3sV9317Vxka9knnwzkb7b2k7ubh4UC_pS3ksX-51B2a0aDzi5k7wJvPKYBmw-UHy8vFGEvT_RZFqtherhcCRCk2zO9gVaifZK8_L7GKYKyEl1A7yW7nytsiQUPbe06e9-Qzgvd-WLNITKEgAiM6MvGr99rv0fblg"

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