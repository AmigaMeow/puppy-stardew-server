#!/bin/bash
# VNC Monitor Script - Keeps x11vnc alive
# VNC 监控脚本 - 保持 x11vnc 服务存活
#
# This script monitors x11vnc process and automatically restarts it
# if it becomes defunct (zombie) or stops listening on port 5900
# 此脚本监控 x11vnc 进程，如果进程变成僵尸或停止监听端口，自动重启

# Color codes for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[VNC-Monitor]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[VNC-Monitor]${NC} ⚠ $1"
}

log_error() {
    echo -e "${RED}[VNC-Monitor]${NC} ✗ $1"
}

log_debug() {
    echo -e "${BLUE}[VNC-Monitor]${NC} [DEBUG] $1"
}

# VNC configuration
VNC_PORT="${VNC_PORT:-5900}"
VNC_DISPLAY="${DISPLAY:-:99}"
# Prefer the inherited VNC_PASSWORD; otherwise read the password file written by
# entrypoint.sh. No weak well-known default is used.
VNC_PASSWORD_FILE="${VNC_PASSWORD_FILE:-/home/steam/web-panel/data/vnc_password.txt}"
if [ -z "$VNC_PASSWORD" ] && [ -f "$VNC_PASSWORD_FILE" ]; then
    VNC_PASSWORD="$(cat "$VNC_PASSWORD_FILE" 2>/dev/null)"
fi
CHECK_INTERVAL="${VNC_CHECK_INTERVAL:-30}"  # Check every 30 seconds

# Function to check if x11vnc is running properly
# 检查 x11vnc 是否正常运行
is_vnc_healthy() {
    # Check 1: Is there an x11vnc process?
    # 检查1：是否存在 x11vnc 进程
    local vnc_pids=$(pgrep -f "x11vnc.*$VNC_PORT" 2>/dev/null)

    if [ -z "$vnc_pids" ]; then
        log_warn "No x11vnc process found"
        return 1
    fi

    # Check 2: Are any processes defunct (zombie)?
    # 检查2：是否有僵尸进程
    for pid in $vnc_pids; do
        local state=$(ps -p $pid -o stat=)
        if [[ "$state" == *"Z"* ]]; then
            log_error "x11vnc process $pid is defunct (zombie)"
            return 1
        fi
    done

    # Check 3: Is port 5900 actually listening?
    # 检查3：端口 5900 是否真正在监听
    if ! netstat -tln 2>/dev/null | grep -q ":$VNC_PORT.*LISTEN"; then
        # netstat might not be available, try ss
        if ! ss -tln 2>/dev/null | grep -q ":$VNC_PORT.*LISTEN"; then
            log_error "Port $VNC_PORT is not listening"
            return 1
        fi
    fi

    return 0
}

# Function to start/restart x11vnc
# 启动/重启 x11vnc
start_vnc() {
    log_info "Starting x11vnc server..."

    # Refuse to start without a password: x11vnc treats -passwd "" as no auth,
    # which would expose VNC unauthenticated. The entrypoint normally exports
    # VNC_PASSWORD (or writes the password file), so an empty value here means
    # something upstream failed.
    if [ -z "$VNC_PASSWORD" ]; then
        log_error "VNC_PASSWORD is empty (env unset and $VNC_PASSWORD_FILE missing); refusing to start x11vnc without authentication"
        return 1
    fi

    # Kill any existing x11vnc processes (including zombies)
    # 杀掉所有现存的 x11vnc 进程（包括僵尸进程）
    pkill -9 -f "x11vnc.*$VNC_PORT" 2>/dev/null
    sleep 2

    # Start x11vnc with robust options
    # 使用稳定的参数启动 x11vnc
    DISPLAY=$VNC_DISPLAY x11vnc \
        -display $VNC_DISPLAY \
        -passwd "$VNC_PASSWORD" \
        -rfbport $VNC_PORT \
        -forever \
        -shared \
        -noxdamage \
        -bg \
        -o /tmp/x11vnc.log \
        2>&1 | grep -v "Have you tried" | head -5

    sleep 3

    # Verify it started successfully
    # 验证是否成功启动
    if is_vnc_healthy; then
        log_info "✓ x11vnc started successfully on port $VNC_PORT"
        return 0
    else
        log_error "Failed to start x11vnc"
        return 1
    fi
}

# Main monitoring loop
# 主监控循环
main() {
    log_info "VNC Monitor started (check interval: ${CHECK_INTERVAL}s)"
    log_info "Monitoring x11vnc on port $VNC_PORT"

    # Initial check - don't start immediately if already running
    # 初始检查 - 如果已经在运行就不重启
    if is_vnc_healthy; then
        log_info "✓ x11vnc is already running and healthy"
    else
        log_warn "Initial health check failed, starting x11vnc..."
        start_vnc
    fi

    # Monitor loop
    # 监控循环
    local check_count=0
    local restart_count=0

    while true; do
        sleep $CHECK_INTERVAL
        check_count=$((check_count + 1))

        if ! is_vnc_healthy; then
            log_warn "Health check #$check_count failed - restarting x11vnc..."

            if start_vnc; then
                restart_count=$((restart_count + 1))
                log_info "x11vnc restarted successfully (restart count: $restart_count)"
            else
                log_error "Failed to restart x11vnc (restart count: $restart_count)"
            fi
        else
            # Only log every 10 checks to reduce noise (every 5 minutes if interval=30s)
            # 每10次检查才记录一次，减少日志噪音（间隔30秒=每5分钟）
            if [ $((check_count % 10)) -eq 0 ]; then
                log_debug "Health check #$check_count passed (restarts: $restart_count)"
            fi
        fi
    done
}

# Handle termination signals
# 处理终止信号
trap 'log_info "VNC monitor shutting down..."; exit 0' SIGTERM SIGINT

# Start monitoring
# 开始监控
main
