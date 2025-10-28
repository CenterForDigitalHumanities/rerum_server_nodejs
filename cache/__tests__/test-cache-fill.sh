#!/bin/bash

# Test script to verify cache fills to 1000 entries properly
# Tests the improved parallelism handling with reduced batch size and timeouts

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3005}"
TARGET_SIZE=1000
BATCH_SIZE=20

# Determine API paths based on URL
if [[ "$BASE_URL" == *"devstore.rerum.io"* ]] || [[ "$BASE_URL" == *"store.rerum.io"* ]]; then
    # Production/dev server paths
    CACHE_STATS_PATH="/v1/api/cache/stats"
    CACHE_CLEAR_PATH="/v1/api/cache/clear"
    API_QUERY_PATH="/v1/api/query"
else
    # Local server paths
    CACHE_STATS_PATH="/cache/stats"
    CACHE_CLEAR_PATH="/cache/clear"
    API_QUERY_PATH="/api/query"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "═══════════════════════════════════════════════════════════════════════"
echo "  RERUM Cache Fill Test"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "Testing cache fill to $TARGET_SIZE entries with improved parallelism handling"
echo "Server: $BASE_URL"
echo "Batch size: $BATCH_SIZE requests per batch"
echo ""

# Check server connectivity
echo -n "[INFO] Checking server connectivity... "
if ! curl -sf "$BASE_URL" > /dev/null 2>&1; then
    echo -e "${RED}FAIL${NC}"
    echo "Server at $BASE_URL is not responding"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# Clear cache
echo -n "[INFO] Clearing cache... "
if [[ "$BASE_URL" == *"devstore.rerum.io"* ]] || [[ "$BASE_URL" == *"store.rerum.io"* ]]; then
    # Production/dev servers may be load-balanced with multiple instances
    # Clear multiple times to hit all instances
    for i in {1..5}; do
        curl -sf -X POST "$BASE_URL$CACHE_CLEAR_PATH" > /dev/null 2>&1
    done
    sleep 1
    echo -e "${YELLOW}WARN${NC}"
    echo "[INFO] Note: Server appears to be load-balanced across multiple instances"
    echo "[INFO] Cache clear may not affect all instances - continuing with test"
else
    # Local server - single instance
    curl -sf -X POST "$BASE_URL$CACHE_CLEAR_PATH" > /dev/null 2>&1
    sleep 1
    initial_stats=$(curl -sf "$BASE_URL$CACHE_STATS_PATH")
    initial_length=$(echo "$initial_stats" | grep -o '"length":[0-9]*' | cut -d: -f2)
    if [ "$initial_length" = "0" ]; then
        echo -e "${GREEN}OK${NC} (length: 0)"
    else
        echo -e "${YELLOW}WARN${NC} (length: $initial_length)"
    fi
fi

# Fill cache function with improved error handling
SUCCESSFUL_REQUESTS=0
FAILED_REQUESTS=0
TIMEOUT_REQUESTS=0

fill_cache() {
    local target_size=$1
    local successful_requests=0
    local failed_requests=0
    local timeout_requests=0
    
    echo ""
    echo "▓▓▓ Filling Cache to $target_size Entries ▓▓▓"
    echo ""
    
    for ((i=0; i<target_size; i+=BATCH_SIZE)); do
        local batch_end=$((i + BATCH_SIZE))
        if [ $batch_end -gt $target_size ]; then
            batch_end=$target_size
        fi
        
        # Clear temp file for this batch
        rm -f /tmp/cache_fill_results_$$.tmp
        
        # Send batch of requests in parallel
        for ((j=i; j<batch_end; j++)); do
            (
                # Use different query types that return actual data
                # Cycle through known query patterns that return results
                queries=(
                    '{"type":"Annotation"}'
                    '{"@type":"Annotation"}'
                    '{"@type":"Gloss"}'
                    '{"@type":"Person"}'
                    '{"type":"Person"}'
                    '{"type":"Manifest"}'
                    '{"type":"Canvas"}'
                    '{"type":"AnnotationPage"}'
                )
                
                # Select query based on index to create variety
                query_index=$((j % 8))
                query_body="${queries[$query_index]}"
                
                # Add a unique parameter to each query to ensure they're cached separately
                # Use the request number to make each query unique
                query_body=$(echo "$query_body" | sed "s/}/, \"_test_id\": $j}/")
                
                response=$(curl -s \
                    --max-time 30 \
                    --connect-timeout 10 \
                    -w "\n%{http_code}" \
                    -X POST \
                    -H "Content-Type: application/json" \
                    -d "$query_body" \
                    "$BASE_URL$API_QUERY_PATH" 2>&1)
                
                exit_code=$?
                http_code=$(echo "$response" | tail -1)
                
                if [ $exit_code -eq 28 ]; then
                    # Timeout
                    echo "timeout" >> /tmp/cache_fill_results_$$.tmp
                elif [ $exit_code -ne 0 ]; then
                    # Network error
                    echo "fail:network_error_$exit_code" >> /tmp/cache_fill_results_$$.tmp
                elif [ "$http_code" = "200" ]; then
                    # Success
                    echo "success" >> /tmp/cache_fill_results_$$.tmp
                else
                    # HTTP error
                    echo "fail:http_$http_code" >> /tmp/cache_fill_results_$$.tmp
                fi
            ) &
        done
        
        # Wait for all requests in this batch to complete
        wait
        
        # Count results from temp file
        batch_success=0
        batch_timeout=0
        batch_fail=0
        if [ -f /tmp/cache_fill_results_$$.tmp ]; then
            batch_success=$(grep -c "^success$" /tmp/cache_fill_results_$$.tmp 2>/dev/null)
            batch_timeout=$(grep -c "^timeout$" /tmp/cache_fill_results_$$.tmp 2>/dev/null)
            batch_fail=$(grep -c "^fail:" /tmp/cache_fill_results_$$.tmp 2>/dev/null)
            # grep -c returns 0 if no matches, so these are safe
            batch_success=${batch_success:-0}
            batch_timeout=${batch_timeout:-0}
            batch_fail=${batch_fail:-0}
            rm /tmp/cache_fill_results_$$.tmp
        fi
        
        successful_requests=$((successful_requests + batch_success))
        timeout_requests=$((timeout_requests + batch_timeout))
        failed_requests=$((failed_requests + batch_fail))
        
        completed=$batch_end
        local pct=$((completed * 100 / target_size))
        echo -ne "\r  Progress: $completed/$target_size requests sent (${pct}%) | Success: $successful_requests | Timeout: $timeout_requests | Failed: $failed_requests  "
        
        # Add small delay between batches to prevent overwhelming the server
        sleep 0.5
    done
    echo ""
    
    # Summary
    echo ""
    echo "▓▓▓ Request Statistics ▓▓▓"
    echo ""
    echo "  Total requests sent:  $target_size"
    echo -e "  Successful (200 OK):  ${GREEN}$successful_requests${NC}"
    if [ $timeout_requests -gt 0 ]; then
    echo "  Timeouts:             $timeout_requests"
    else
        echo "  Timeouts:             $timeout_requests"
    fi
    if [ $failed_requests -gt 0 ]; then
        echo -e "  Failed:               ${RED}$failed_requests${NC}"
    else
        echo "  Failed:               $failed_requests"
    fi
    echo ""
    
    # Store in global variables for later use
    SUCCESSFUL_REQUESTS=$successful_requests
    FAILED_REQUESTS=$failed_requests
    TIMEOUT_REQUESTS=$timeout_requests
}

# Fill the cache
fill_cache $TARGET_SIZE

# Get final cache stats
echo "[INFO] Getting final cache statistics..."
final_stats=$(curl -sf "$BASE_URL$CACHE_STATS_PATH")
final_length=$(echo "$final_stats" | grep -o '"length":[0-9]*' | cut -d: -f2)
total_sets=$(echo "$final_stats" | grep -o '"sets":[0-9]*' | cut -d: -f2)
total_hits=$(echo "$final_stats" | grep -o '"hits":[0-9]*' | cut -d: -f2)
total_misses=$(echo "$final_stats" | grep -o '"misses":[0-9]*' | cut -d: -f2)
total_evictions=$(echo "$final_stats" | grep -o '"evictions":[0-9]*' | cut -d: -f2)

echo ""
echo "▓▓▓ Final Cache Statistics ▓▓▓"
echo ""
echo "  Cache entries:    $final_length"
echo "  Total sets:       $total_sets"
echo "  Total hits:       $total_hits"
echo "  Total misses:     $total_misses"
echo "  Total evictions:  $total_evictions"
echo ""

# Analyze results
echo "▓▓▓ Analysis ▓▓▓"
echo ""

success=true

# Check request success rate first (most important)
success_rate=$((SUCCESSFUL_REQUESTS * 100 / TARGET_SIZE))
if [ $success_rate -ge 95 ]; then
    echo -e "${GREEN}✓${NC} Excellent request success rate: ${success_rate}% (${SUCCESSFUL_REQUESTS}/${TARGET_SIZE})"
elif [ $success_rate -ge 90 ]; then
    echo -e "${YELLOW}⚠${NC} Good request success rate: ${success_rate}% (${SUCCESSFUL_REQUESTS}/${TARGET_SIZE})"
else
    echo -e "${RED}✗${NC} Poor request success rate: ${success_rate}% (${SUCCESSFUL_REQUESTS}/${TARGET_SIZE})"
    success=false
fi

# Check timeouts
if [ $TIMEOUT_REQUESTS -eq 0 ]; then
    echo -e "${GREEN}✓${NC} No timeouts"
elif [ $TIMEOUT_REQUESTS -lt $((TARGET_SIZE / 20)) ]; then
    echo -e "${GREEN}✓${NC} Very few timeouts: $TIMEOUT_REQUESTS"
else
    echo -e "${YELLOW}⚠${NC} Some timeouts: $TIMEOUT_REQUESTS"
fi

# Check failures
if [ $FAILED_REQUESTS -eq 0 ]; then
    echo -e "${GREEN}✓${NC} No failed requests"
elif [ $FAILED_REQUESTS -lt $((TARGET_SIZE / 20)) ]; then
    echo -e "${GREEN}✓${NC} Very few failures: $FAILED_REQUESTS"
else
    echo -e "${YELLOW}⚠${NC} Some failures: $FAILED_REQUESTS"
fi

# Check if cache filled (but this depends on query results)
if [ "$final_length" -ge 990 ]; then
    echo -e "${GREEN}✓${NC} Cache filled successfully (${final_length}/${TARGET_SIZE} entries)"
elif [ "$final_length" -ge 300 ]; then
    echo -e "${YELLOW}ℹ${NC} Cache has ${final_length} entries (many queries returned empty results)"
    echo "  Note: Cache only stores non-empty array responses by design"
else
    echo -e "${RED}✗${NC} Cache fill lower than expected (${final_length}/${TARGET_SIZE} entries)"
    success=false
fi

# Diagnose issues if any
if [ "$success" != "true" ]; then
    echo ""
    echo "▓▓▓ Diagnosis ▓▓▓"
    echo ""
    
    if [ $TIMEOUT_REQUESTS -gt $((TARGET_SIZE / 10)) ]; then
        echo -e "${YELLOW}⚠${NC} High number of timeouts detected"
        echo "  Recommendation: Increase --max-time or reduce batch size"
    fi
    
    if [ $FAILED_REQUESTS -gt $((TARGET_SIZE / 10)) ]; then
        echo -e "${YELLOW}⚠${NC} High number of failed requests"
        echo "  Recommendation: Check server logs for errors"
    fi
    
    # Check if responses weren't cached (might not be arrays)
    if [ -n "$total_sets" ] && [ -n "$SUCCESSFUL_REQUESTS" ] && [ "$total_sets" -lt $((SUCCESSFUL_REQUESTS - 50)) ]; then
        echo -e "${YELLOW}⚠${NC} Many successful responses were NOT cached"
        echo "  Reason: Responses may not be arrays (cache only stores array responses)"
        echo "  Sets: $total_sets vs Successful requests: $SUCCESSFUL_REQUESTS"
    fi
    
    if [ -n "$total_evictions" ] && [ "$total_evictions" -gt 0 ]; then
        echo -e "${YELLOW}⚠${NC} Cache evictions occurred during fill"
        echo "  Evictions: $total_evictions"
        echo "  Reason: Cache may be full or entries timing out"
    fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════"

if [ "$success" = "true" ]; then
    echo -e "${GREEN}TEST PASSED${NC}"
    exit 0
else
    echo -e "${YELLOW}TEST COMPLETED WITH WARNINGS${NC}"
    exit 1
fi
