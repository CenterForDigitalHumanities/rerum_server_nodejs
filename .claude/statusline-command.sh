#!/bin/bash

# Read JSON input
input=$(cat)

# Extract data from JSON
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
api_duration=$(echo "$input" | jq -r '.cost.total_api_duration_ms // 0')
total_duration=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')
model_display=$(echo "$input" | jq -r '.model.display_name // "unknown"')

# Calculate API duration in seconds
api_duration_sec=$(echo "scale=1; $api_duration / 1000" | bc -l 2>/dev/null || echo "0")

# Get git branch if in a git repository
git_branch=""
if git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
    branch=$(git -C "$cwd" -c core.fileMode=false branch --show-current 2>/dev/null)
    if [ -n "$branch" ]; then
        git_branch="($branch)"
    fi
fi

# Build the enhanced status line
# Format: (branch) model $cost | API: Xs | +L/-L

# Cyan for git branch
if [ -n "$git_branch" ]; then
    printf '\033[36m%s\033[0m ' "$git_branch"
fi

# Magenta for model name
printf '\033[35m%s\033[0m ' "$model_display"

# Bold yellow for cost (live updating token usage proxy)
printf '\033[1;33m$%.4f\033[0m' "$cost"

# Green for API time (shows compute usage)
if [ "$api_duration" != "0" ]; then
    printf ' \033[32m| API: %ss\033[0m' "$api_duration_sec"
fi

# White for code changes (productivity)
if [ "$lines_added" != "0" ] || [ "$lines_removed" != "0" ]; then
    printf ' \033[37m| +%s/-%s\033[0m' "$lines_added" "$lines_removed"
fi

printf '\n'
