#!/bin/bash
# Status Reporter - Prometheus metrics endpoint + JSON status file
# 状态报告器 - Prometheus 指标端点 + JSON 状态文件
#
# Serves Prometheus-format metrics on port 9090 via a lightweight HTTP handler.
# Also writes a JSON status file for local consumption.
#
# Metrics exposed:
#   puppy_stardew_game_running         - Whether the game process is alive (1/0)
#   puppy_stardew_uptime_seconds       - Game process uptime in seconds
#   puppy_stardew_players_online       - Number of connected players
#   puppy_stardew_memory_usage_mb      - Game process RSS memory in MB
#   puppy_stardew_cpu_usage_percent    - Game process CPU usage percent
#   puppy_stardew_events_passout_total - Total passout events detected
#   puppy_stardew_events_readycheck_total  - Total ready-check events
#   puppy_stardew_events_offline_total - Total offline-mode events
#   puppy_stardew_script_healthy       - Whether background scripts are alive (1/0)

STATUS_FILE="/home/steam/.local/share/puppy-stardew/status.json"
METRICS_FILE="/home/steam/.local/share/puppy-stardew/metrics.prom"
SMAPI_LOG="/home/steam/.config/StardewValley/ErrorLogs/SMAPI-latest.txt"
METRICS_PORT=${METRICS_PORT:-9090}
UPDATE_INTERVAL=15

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[Status-Reporter]${NC} $1"; }

mkdir -p "$(dirname "$STATUS_FILE")"
mkdir -p "$(dirname "$METRICS_FILE")"

# =============================================
# Metric collection functions
# =============================================

get_uptime_seconds() {
    local pid=$(pgrep -f StardewModdingAPI 2>/dev/null | head -1)
    if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
        local start_time=$(stat -c %Y "/proc/$pid" 2>/dev/null)
        if [ -n "$start_time" ]; then
            echo $(($(date +%s) - start_time))
            return
        fi
    fi
    echo "0"
}

get_player_count() {
    if [ -f "$SMAPI_LOG" ]; then
        awk '
            function mark_join(id) {
                if (id != "" && id != "Server" && id != "SMAPI") connected[id] = 1
            }
            function mark_leave(id) {
                if (id != "") delete connected[id]
            }
            match($0, /Received connection for vanilla player ([A-Za-z0-9_]+)/, a) { mark_join(a[1]); next }
            match($0, /Approved request for farmhand ([A-Za-z0-9_]+)/, a) { mark_join(a[1]); next }
            match($0, /([A-Za-z0-9_]+) joined the game/, a) { mark_join(a[1]); next }
            match($0, /farmhand ([A-Za-z0-9_]+) connected/, a) { mark_join(a[1]); next }
            match($0, /client ([A-Za-z0-9_]+) connected/, a) { mark_join(a[1]); next }
            match($0, /peer ([A-Za-z0-9_]+) joined/, a) { mark_join(a[1]); next }
            match($0, /([A-Za-z0-9_]+) connected/, a) { mark_join(a[1]); next }
            match($0, /([A-Za-z0-9_]+) left the game/, a) { mark_leave(a[1]); next }
            match($0, /farmhand ([A-Za-z0-9_]+) disconnected/, a) { mark_leave(a[1]); next }
            match($0, /client ([A-Za-z0-9_]+) disconnected/, a) { mark_leave(a[1]); next }
            match($0, /peer ([A-Za-z0-9_]+) left/, a) { mark_leave(a[1]); next }
            match($0, /connection ([A-Za-z0-9_]+) disconnected/, a) { mark_leave(a[1]); next }
            match($0, /player ([A-Za-z0-9_]+) disconnected/, a) { mark_leave(a[1]); next }
            match($0, /([A-Za-z0-9_]+) disconnected/, a) { mark_leave(a[1]); next }
            END {
                count = 0
                for (id in connected) count++
                print count
            }
        ' "$SMAPI_LOG" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

get_game_day() {
    if [ -f "$SMAPI_LOG" ]; then
        local day_info=""
        day_info=$(grep -oP "starting \K[a-z]+ \d+ Y\d+" "$SMAPI_LOG" 2>/dev/null | tail -1 || true)
        if [ -z "$day_info" ]; then
            day_info=$(grep -oP "Season:\s*\K[a-z]+, Day \d+, Year \d+" "$SMAPI_LOG" 2>/dev/null | tail -1 || true)
        fi
        echo "${day_info:-Unknown}"
    else
        echo "Not started"
    fi
}

get_game_paused() {
    if [ ! -f "$SMAPI_LOG" ]; then
        echo "0"
        return
    fi

    local latest_state
    latest_state=$(grep -nE "Disconnected: ServerOfflineMode|Starting LAN server|joined the game|player connected|farmhand connected|peer .* joined|client .* connected" "$SMAPI_LOG" 2>/dev/null | tail -1 || true)

    if echo "$latest_state" | grep -q "Disconnected: ServerOfflineMode"; then
        echo "1"
    else
        echo "0"
    fi
}

get_memory_usage_mb() {
    local pid=$(pgrep -f StardewModdingAPI 2>/dev/null | head -1)
    if [ -n "$pid" ] && [ -f "/proc/$pid/status" ]; then
        local rss=$(grep "VmRSS" "/proc/$pid/status" 2>/dev/null | awk '{print $2}')
        if [ -n "$rss" ]; then
            echo "$((rss / 1024))"
            return
        fi
    fi
    echo "0"
}

get_cpu_usage() {
    local pid=$(pgrep -f StardewModdingAPI 2>/dev/null | head -1)
    if [ -n "$pid" ]; then
        local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
        echo "${cpu:-0.0}"
    else
        echo "0.0"
    fi
}

get_event_counts() {
    local passout=0 readycheck=0 offline=0
    if [ -f "$SMAPI_LOG" ]; then
        passout=$(grep -ciE "passed out|exhausted|collapsed" "$SMAPI_LOG" 2>/dev/null || echo "0")
        readycheck=$(grep -c "ReadyCheckDialog" "$SMAPI_LOG" 2>/dev/null || echo "0")
        offline=$(grep -c "ServerOfflineMode" "$SMAPI_LOG" 2>/dev/null || echo "0")
    fi
    echo "$passout $readycheck $offline"
}

check_script_health() {
    # Check that key background scripts are running
    local healthy=1
    if ! pgrep -f "event-handler.sh" >/dev/null 2>&1; then
        healthy=0
    fi
    echo "$healthy"
}

# =============================================
# Generate Prometheus-format metrics
# =============================================
update_metrics() {
    local game_running=0
    pgrep -f StardewModdingAPI >/dev/null 2>&1 && game_running=1

    local uptime=$(get_uptime_seconds)
    local players=$(get_player_count)
    case "$players" in
        ''|*[!0-9]*)
            players=0
            ;;
    esac
    local game_day=$(get_game_day)
    local game_paused=$(get_game_paused)
    local memory=$(get_memory_usage_mb)
    local cpu=$(get_cpu_usage)
    local events=($(get_event_counts))
    local passout=${events[0]:-0}
    local readycheck=${events[1]:-0}
    local offline=${events[2]:-0}
    local script_health=$(check_script_health)
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Write Prometheus metrics file (atomic write via temp file)
    local tmp_metrics="${METRICS_FILE}.tmp"
    cat > "$tmp_metrics" << EOPROM
# HELP puppy_stardew_game_running Whether the Stardew Valley game process is running.
# TYPE puppy_stardew_game_running gauge
puppy_stardew_game_running $game_running

# HELP puppy_stardew_uptime_seconds Game process uptime in seconds.
# TYPE puppy_stardew_uptime_seconds gauge
puppy_stardew_uptime_seconds $uptime

# HELP puppy_stardew_players_online Number of players currently connected.
# TYPE puppy_stardew_players_online gauge
puppy_stardew_players_online $players

# HELP puppy_stardew_memory_usage_mb Game process RSS memory usage in megabytes.
# TYPE puppy_stardew_memory_usage_mb gauge
puppy_stardew_memory_usage_mb $memory

# HELP puppy_stardew_cpu_usage_percent Game process CPU usage percentage.
# TYPE puppy_stardew_cpu_usage_percent gauge
puppy_stardew_cpu_usage_percent $cpu

# HELP puppy_stardew_events_passout_total Total number of passout events detected.
# TYPE puppy_stardew_events_passout_total counter
puppy_stardew_events_passout_total $passout

# HELP puppy_stardew_events_readycheck_total Total number of ready-check dialog events.
# TYPE puppy_stardew_events_readycheck_total counter
puppy_stardew_events_readycheck_total $readycheck

# HELP puppy_stardew_events_offline_total Total number of server-offline events.
# TYPE puppy_stardew_events_offline_total counter
puppy_stardew_events_offline_total $offline

# HELP puppy_stardew_script_healthy Whether background scripts are running.
# TYPE puppy_stardew_script_healthy gauge
puppy_stardew_script_healthy $script_health
EOPROM
    mv "$tmp_metrics" "$METRICS_FILE"

    # Write JSON status file for local tools
    local tmp_status="${STATUS_FILE}.tmp"
    cat > "$tmp_status" << EOJSON
{
  "timestamp": "$timestamp",
  "server": {
    "version": "1.1.0",
    "game_running": $([ "$game_running" = "1" ] && echo "true" || echo "false"),
    "uptime_seconds": $uptime
  },
  "game": {
    "day": "$game_day",
    "players_online": $players,
    "paused": $([ "$game_paused" = "1" ] && echo "true" || echo "false")
  },
  "resources": {
    "memory_mb": $memory,
    "cpu_percent": $cpu
  },
  "events": {
    "passout": $passout,
    "readycheck": $readycheck,
    "offline": $offline
  },
  "scripts_healthy": $([ "$script_health" = "1" ] && echo "true" || echo "false")
}
EOJSON
    mv "$tmp_status" "$STATUS_FILE"
}

# =============================================
# HTTP server using bash + nc (netcat)
# Serves /metrics endpoint on METRICS_PORT
# =============================================
serve_metrics() {
    log "Starting Prometheus metrics HTTP server on port $METRICS_PORT..."
    log "Prometheus 指标 HTTP 服务启动于端口 $METRICS_PORT..."

    while true; do
        # Read metrics file content
        local body=""
        if [ -f "$METRICS_FILE" ]; then
            body=$(cat "$METRICS_FILE" 2>/dev/null)
        else
            body="# No metrics available yet"
        fi

        local content_length=${#body}

        # Serve one request via nc (netcat-openbsd)
        # netcat-openbsd: -l PORT (no -p flag with -l)
        # -q 1: quit 1 second after EOF, -w 5: timeout 5s
        {
            echo -e "HTTP/1.1 200 OK\r"
            echo -e "Content-Type: text/plain; version=0.0.4; charset=utf-8\r"
            echo -e "Content-Length: ${content_length}\r"
            echo -e "Connection: close\r"
            echo -e "\r"
            echo -n "$body"
        } | nc -l "$METRICS_PORT" -q 1 -w 5 >/dev/null 2>&1
    done
}

# =============================================
# Main
# =============================================
log "Status reporter starting..."
log "状态报告器启动..."
log "  Metrics port: $METRICS_PORT"
log "  Update interval: ${UPDATE_INTERVAL}s"
log "  Status file: $STATUS_FILE"

# Wait for game to start
sleep 30

# Start HTTP server in background
serve_metrics &
SERVE_PID=$!
log "✓ HTTP metrics server started (PID: $SERVE_PID)"

# Metrics collection loop
while true; do
    update_metrics
    sleep $UPDATE_INTERVAL
done
