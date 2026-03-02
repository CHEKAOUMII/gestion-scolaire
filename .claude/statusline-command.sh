#!/bin/bash
input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

parts=()

if [ -n "$cwd" ]; then
    parts+=("$(basename "$cwd")")
fi

if [ -n "$model" ]; then
    parts+=("$model")
fi

if [ -n "$used" ] && [ -n "$remaining" ]; then
    parts+=("ctx: ${used}% used / ${remaining}% left")
elif [ -n "$remaining" ]; then
    parts+=("ctx: ${remaining}% left")
elif [ -n "$used" ]; then
    parts+=("ctx: ${used}% used")
else
    parts+=("ctx: --")
fi

printf '%s' "$(IFS=' | '; echo "${parts[*]}")"
