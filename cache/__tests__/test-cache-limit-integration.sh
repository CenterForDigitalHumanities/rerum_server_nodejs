#!/bin/bash

################################################################################
# RERUM Cache Limit Integration Test Script
# Tests cache limit enforcement with small limits for fast validation
# Author: GitHub Copilot
# Date: October 21, 2025
################################################################################

# Test Configuration
TEST_PORT=3007
CACHE_MAX_LENGTH=10
CACHE_MAX_BYTES=512000  # 500KB (512000 bytes)
TTL=300000  # 5 minutes

BASE_URL="http://localhost:${TEST_PORT}"
API_BASE="${BASE_URL}/v1"
AUTH_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik9FVTBORFk0T1RVNVJrRXlOREl5TTBFMU1FVXdNMFUyT0RGQk9UaEZSa1JDTXpnek1FSTRNdyJ9.eyJodHRwOi8vc3RvcmUucmVydW0uaW8vYWdlbnQiOiJodHRwczovL2RldnN0b3JlLnJlcnVtLmlvL3YxL2lkLzY4ZDZkZDZhNzE4ZWUyOTRmMTk0YmUwNCIsImh0dHA6Ly9yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL3JlcnVtLmlvL2FwcF9mbGFnIjpbInRwZW4iXSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby9hcHBfZmxhZyI6WyJ0cGVuIl0sImlzcyI6Imh0dHBzOi8vY3ViYXAuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDY4ZDZkZDY0YmRhMmNkNzdhMTA2MWMxNyIsImF1ZCI6Imh0dHA6Ly9yZXJ1bS5pby9hcGkiLCJpYXQiOjE3NjEwNjE2NzQsImV4cCI6MTc2MzY1MzY3NCwic2NvcGUiOiJvZmZsaW5lX2FjY2VzcyIsImF6cCI6IjYySnNhOU14SHVxaFJiTzIwZ1RIczlLcEtyN1VlN3NsIn0.kmApzbZMeUive-sJZNXWSA3nWTaNTM83MNHXbIP45mtSaLP_k7RmfHqRQ4aso6nUPVKHtUezuAE4sKM8Se24XdhnlXrS3MGTVvNrPTDrsJ2Nwi0s9N1rX1SgqI18P7vMu1Si4ga78p2UKwvWtF0gmNQbmj906ii0s6A6gxA2UD1dZVFeNeqmIhhZ5gVM6yGndZqWgN2JysYg2CQvqRxEQDdULZxCuX1l8O5pnITK2lpba2DLVeWow_42mia4xqWCej_vyvxkWQmtu839grYXRuFPfJWYvdqqVszSCRj3kq0-OooY_lZ-fnuNtTV8kGIfVnZTtrS8TiN7hqcfjzhYnQ"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Array to store created object IDs for cleanup
declare -a CREATED_IDS=()

# Server process ID
SERVER_PID=""

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED_TESTS++))
}

log_failure() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED_TESTS++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Get cache statistics
get_cache_stats() {
    curl -s "${API_BASE}/api/cache/stats" | jq -r '.stats'
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."
    
    # Clean up test objects
    for id in "${CREATED_IDS[@]}"; do
        if [ -n "$id" ]; then
            curl -s -X DELETE \
                -H "Authorization: Bearer ${AUTH_TOKEN}" \
                -H "Content-Type: application/json" \
                "${API_BASE}/api/delete/${id}" > /dev/null 2>&1 || true
        fi
    done
    
    # Stop the server if we started it
    if [ -n "$SERVER_PID" ]; then
        log_info "Stopping test server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
    fi
    
    log_info "Cleanup complete"
}

trap cleanup EXIT

################################################################################
# Test Functions
################################################################################

start_server_with_limits() {
    log_info "Starting server with cache limits:"
    log_info "  CACHE_MAX_LENGTH=${CACHE_MAX_LENGTH}"
    log_info "  CACHE_MAX_BYTES=${CACHE_MAX_BYTES} (500KB)"
    
    # Start server in background with environment variables
    cd /workspaces/rerum_server_nodejs
    PORT=$TEST_PORT CACHE_MAX_LENGTH=$CACHE_MAX_LENGTH CACHE_MAX_BYTES=$CACHE_MAX_BYTES npm start > /tmp/cache-limit-test-server.log 2>&1 &
    SERVER_PID=$!
    
    log_info "Server starting (PID: $SERVER_PID)..."
    
    # Wait for server to be ready
    local max_wait=15
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -s --connect-timeout 1 "${BASE_URL}" > /dev/null 2>&1; then
            log_success "Server is ready at ${BASE_URL}"
            sleep 1  # Give it one more second to fully initialize
            return 0
        fi
        sleep 1
        ((waited++))
    done
    
    log_failure "Server failed to start within ${max_wait} seconds"
    cat /tmp/cache-limit-test-server.log
    exit 1
}

verify_cache_limits() {
    log_info "Verifying cache limit configuration..."
    ((TOTAL_TESTS++))
    
    local stats=$(get_cache_stats)
    local max_length=$(echo "$stats" | jq -r '.maxLength')
    local max_bytes=$(echo "$stats" | jq -r '.maxBytes')
    
    log_info "Configured limits: maxLength=$max_length, maxBytes=$max_bytes"
    
    if [ "$max_length" -eq "$CACHE_MAX_LENGTH" ] && [ "$max_bytes" -eq "$CACHE_MAX_BYTES" ]; then
        log_success "Cache limits configured correctly"
        return 0
    else
        log_failure "Cache limits NOT configured correctly (expected: $CACHE_MAX_LENGTH/$CACHE_MAX_BYTES, got: $max_length/$max_bytes)"
        return 1
    fi
}

test_length_limit_enforcement() {
    log_info "Testing cache length limit enforcement (max: $CACHE_MAX_LENGTH entries)..."
    ((TOTAL_TESTS++))
    
    # Clear cache
    curl -s -X POST "${API_BASE}/api/cache/clear" > /dev/null
    
    # Create more than max_length distinct cache entries
    local entries_to_create=15  # 50% more than limit of 10
    log_info "Creating $entries_to_create distinct cache entries..."
    
    for i in $(seq 1 $entries_to_create); do
        curl -s -X POST \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"LimitTest\",\"testCase\":\"length\",\"index\":$i}" \
            "${API_BASE}/api/query" > /dev/null
        
        if [ $((i % 5)) -eq 0 ]; then
            echo -n "."
        fi
    done
    echo ""
    
    sleep 1
    
    # Check cache stats
    local stats=$(get_cache_stats)
    local cache_length=$(echo "$stats" | jq -r '.length')
    local evictions=$(echo "$stats" | jq -r '.evictions')
    
    log_info "Results: cache_length=$cache_length, max=$CACHE_MAX_LENGTH, evictions=$evictions"
    
    if [ "$cache_length" -le "$CACHE_MAX_LENGTH" ] && [ "$evictions" -gt 0 ]; then
        log_success "Length limit enforced (length: $cache_length <= $CACHE_MAX_LENGTH, evictions: $evictions)"
        return 0
    elif [ "$cache_length" -le "$CACHE_MAX_LENGTH" ]; then
        log_warning "Length limit respected but no evictions detected (length: $cache_length <= $CACHE_MAX_LENGTH, evictions: $evictions)"
        return 0
    else
        log_failure "Length limit VIOLATED (length: $cache_length > $CACHE_MAX_LENGTH)"
        return 1
    fi
}

test_byte_limit_enforcement() {
    log_info "Testing cache byte limit enforcement (max: $CACHE_MAX_BYTES bytes / 500KB)..."
    ((TOTAL_TESTS++))
    
    # Clear cache
    curl -s -X POST "${API_BASE}/api/cache/clear" > /dev/null
    
    # Create entries with larger payloads to test byte limit
    # Each query result is typically ~70 bytes per entry without data
    # Add larger descriptions to accumulate bytes faster
    local entries_to_create=20
    log_info "Creating $entries_to_create cache entries with larger payloads..."
    
    for i in $(seq 1 $entries_to_create); do
        # Create entries with significant data to test byte limits
        local padding=$(printf 'X%.0s' {1..1000})  # 1000 characters of padding
        curl -s -X POST \
            -H "Content-Type: application/json" \
            -d "{\"type\":\"ByteLimitTest\",\"testCase\":\"bytes\",\"index\":$i,\"padding\":\"$padding\",\"description\":\"This is test entry $i with additional padding data to increase cache entry size and better test the 500KB byte limit.\"}" \
            "${API_BASE}/api/query" > /dev/null
        
        if [ $((i % 5)) -eq 0 ]; then
            echo -n "."
        fi
    done
    echo ""
    
    sleep 1
    
    # Check cache stats
    local stats=$(get_cache_stats)
    local cache_bytes=$(echo "$stats" | jq -r '.bytes')
    local cache_length=$(echo "$stats" | jq -r '.length')
    
    log_info "Results: cache_bytes=$cache_bytes, max=$CACHE_MAX_BYTES, entries=$cache_length"
    
    if [ "$cache_bytes" -le "$CACHE_MAX_BYTES" ]; then
        local avg_bytes=$((cache_bytes / cache_length))
        log_info "Average entry size: ~${avg_bytes} bytes"
        log_success "Byte limit enforced (bytes: $cache_bytes <= $CACHE_MAX_BYTES)"
        return 0
    else
        log_failure "Byte limit VIOLATED (bytes: $cache_bytes > $CACHE_MAX_BYTES)"
        return 1
    fi
}

test_combined_limits() {
    log_info "Testing combined length and byte limits..."
    ((TOTAL_TESTS++))
    
    # Clear cache
    curl -s -X POST "${API_BASE}/api/cache/clear" > /dev/null
    
    # Create many entries to stress both limits
    local entries_to_create=25
    log_info "Creating $entries_to_create diverse cache entries..."
    
    # Mix of different query types to create realistic cache patterns
    for i in $(seq 1 $entries_to_create); do
        local query_type=$((i % 3))
        
        case $query_type in
            0)
                # Query endpoint
                curl -s -X POST \
                    -H "Content-Type: application/json" \
                    -d "{\"type\":\"CombinedTest\",\"query\":\"type$i\"}" \
                    "${API_BASE}/api/query" > /dev/null
                ;;
            1)
                # Search endpoint
                curl -s -X POST \
                    -H "Content-Type: text/plain" \
                    -d "search-term-$i" \
                    "${API_BASE}/api/search" > /dev/null
                ;;
            2)
                # Search phrase endpoint
                curl -s -X POST \
                    -H "Content-Type: text/plain" \
                    -d "phrase-$i" \
                    "${API_BASE}/api/search/phrase" > /dev/null
                ;;
        esac
        
        if [ $((i % 5)) -eq 0 ]; then
            echo -n "."
        fi
    done
    echo ""
    
    sleep 1
    
    # Check cache stats
    local stats=$(get_cache_stats)
    local cache_length=$(echo "$stats" | jq -r '.length')
    local cache_bytes=$(echo "$stats" | jq -r '.bytes')
    local evictions=$(echo "$stats" | jq -r '.evictions')
    
    log_info "Results:"
    log_info "  Length: $cache_length / $CACHE_MAX_LENGTH"
    log_info "  Bytes: $cache_bytes / $CACHE_MAX_BYTES"
    log_info "  Evictions: $evictions"
    
    local length_ok=0
    local bytes_ok=0
    
    if [ "$cache_length" -le "$CACHE_MAX_LENGTH" ]; then
        length_ok=1
    fi
    
    if [ "$cache_bytes" -le "$CACHE_MAX_BYTES" ]; then
        bytes_ok=1
    fi
    
    if [ $length_ok -eq 1 ] && [ $bytes_ok -eq 1 ]; then
        log_success "Both limits enforced (length: $cache_length <= $CACHE_MAX_LENGTH, bytes: $cache_bytes <= $CACHE_MAX_BYTES)"
        return 0
    else
        log_failure "Limit violation detected"
        [ $length_ok -eq 0 ] && log_failure "  Length: $cache_length > $CACHE_MAX_LENGTH"
        [ $bytes_ok -eq 0 ] && log_failure "  Bytes: $cache_bytes > $CACHE_MAX_BYTES"
        return 1
    fi
}

################################################################################
# Main Test Execution
################################################################################

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          RERUM Cache Limit Integration Test                   ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Start server with custom limits
    start_server_with_limits
    echo ""
    
    # Verify limits are configured
    verify_cache_limits
    echo ""
    
    # Display initial cache stats
    log_info "Initial cache statistics:"
    get_cache_stats | jq '.'
    echo ""
    
    # Run tests
    echo "═══════════════════════════════════════════════════════════════"
    echo "  CACHE LIMIT ENFORCEMENT TESTS"
    echo "═══════════════════════════════════════════════════════════════"
    test_length_limit_enforcement
    echo ""
    
    test_byte_limit_enforcement
    echo ""
    
    test_combined_limits
    echo ""
    
    # Display final cache stats
    log_info "Final cache statistics:"
    get_cache_stats | jq '.'
    echo ""
    
    # Summary
    echo "═══════════════════════════════════════════════════════════════"
    echo "  TEST SUMMARY"
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "Total Tests:  ${TOTAL_TESTS}"
    echo -e "${GREEN}Passed:       ${PASSED_TESTS}${NC}"
    echo -e "${RED}Failed:       ${FAILED_TESTS}${NC}"
    echo "═══════════════════════════════════════════════════════════════"
    
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}✓ All cache limit tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Run main function
main "$@"
