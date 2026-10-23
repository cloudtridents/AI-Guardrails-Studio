#!/usr/bin/env bash
#
# Guardrails Platform - Application Manager
# Usage: ./app.sh {start|stop|restart|status|logs|verbose}
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Python interpreter for the backend.
#
# This project lives on an exFAT drive, which cannot host a virtualenv (no
# symlink support). The venv therefore lives on an ext4 filesystem and reaches
# the heavy, already-installed packages (torch/transformers/nemoguardrails) on
# the exFAT drive via a .pth file. Override with the BACKEND_PYTHON env var.
BACKEND_PYTHON="${BACKEND_PYTHON:-$HOME/guardrails-venv/bin/python}"

BACKEND_PORT=9000
FRONTEND_PORT=5173
BACKEND_PID_FILE="$ROOT_DIR/.backend.pid"
FRONTEND_PID_FILE="$ROOT_DIR/.frontend.pid"
LOG_DIR="$ROOT_DIR/logs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${CYAN}[STEP]${NC} $1"; }

ensure_dirs() {
    mkdir -p "$LOG_DIR"
}

# ─── Start Backend ────────────────────────────────────────────────────────────

start_backend() {
    local verbose="${1:-false}"

    if is_running "backend"; then
        log_warn "Backend already running (PID $(cat "$BACKEND_PID_FILE"))"
        return 0
    fi

    log_step "Starting backend on port $BACKEND_PORT..."

    if [ ! -x "$BACKEND_PYTHON" ]; then
        log_error "Backend Python not found at: $BACKEND_PYTHON"
        log_error "Set BACKEND_PYTHON to your interpreter, e.g. BACKEND_PYTHON=/path/to/venv/bin/python ./app.sh start"
        return 1
    fi

    cd "$BACKEND_DIR"

    if [ "$verbose" = "true" ]; then
        "$BACKEND_PYTHON" -m uvicorn app.main:app \
            --reload \
            --port "$BACKEND_PORT" \
            --log-level debug \
            2>&1 | tee "$LOG_DIR/backend.log" &
    else
        "$BACKEND_PYTHON" -m uvicorn app.main:app \
            --reload \
            --port "$BACKEND_PORT" \
            > "$LOG_DIR/backend.log" 2>&1 &
    fi

    echo $! > "$BACKEND_PID_FILE"
    sleep 2

    if is_running "backend"; then
        log_info "Backend started (PID $(cat "$BACKEND_PID_FILE")) → http://localhost:$BACKEND_PORT"
        log_info "API Docs → http://localhost:$BACKEND_PORT/docs"
    else
        log_error "Backend failed to start. Check logs: $LOG_DIR/backend.log"
        return 1
    fi
}

# ─── Start Frontend ───────────────────────────────────────────────────────────

start_frontend() {
    local verbose="${1:-false}"

    if is_running "frontend"; then
        log_warn "Frontend already running (PID $(cat "$FRONTEND_PID_FILE"))"
        return 0
    fi

    log_step "Starting frontend..."

    cd "$FRONTEND_DIR"

    if [ "$verbose" = "true" ]; then
        npx vite --port "$FRONTEND_PORT" 2>&1 | tee "$LOG_DIR/frontend.log" &
    else
        npx vite --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &
    fi

    echo $! > "$FRONTEND_PID_FILE"
    sleep 3

    # Vite may pick a different port if 5173 is busy
    local actual_port
    actual_port=$(grep -oP 'localhost:\K[0-9]+' "$LOG_DIR/frontend.log" 2>/dev/null | head -1)
    actual_port="${actual_port:-$FRONTEND_PORT}"

    if is_running "frontend"; then
        log_info "Frontend started (PID $(cat "$FRONTEND_PID_FILE")) → http://localhost:$actual_port"
    else
        log_error "Frontend failed to start. Check logs: $LOG_DIR/frontend.log"
        return 1
    fi
}

# ─── Stop ─────────────────────────────────────────────────────────────────────

stop_backend() {
    if is_running "backend"; then
        local pid=$(cat "$BACKEND_PID_FILE")
        log_step "Stopping backend (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        # Also kill any child processes (uvicorn reload spawns children)
        pkill -P "$pid" 2>/dev/null || true
        rm -f "$BACKEND_PID_FILE"
        log_info "Backend stopped"
    else
        log_warn "Backend not running"
        rm -f "$BACKEND_PID_FILE"
    fi

    # Kill anything on the port as fallback
    fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true
}

stop_frontend() {
    if is_running "frontend"; then
        local pid=$(cat "$FRONTEND_PID_FILE")
        log_step "Stopping frontend (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        pkill -P "$pid" 2>/dev/null || true
        rm -f "$FRONTEND_PID_FILE"
        log_info "Frontend stopped"
    else
        log_warn "Frontend not running"
        rm -f "$FRONTEND_PID_FILE"
    fi
}

# ─── Status Check ─────────────────────────────────────────────────────────────

is_running() {
    local service="$1"
    local pid_file

    case "$service" in
        backend)  pid_file="$BACKEND_PID_FILE" ;;
        frontend) pid_file="$FRONTEND_PID_FILE" ;;
    esac

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

show_status() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Guardrails Platform Status${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Backend
    if is_running "backend"; then
        local bpid=$(cat "$BACKEND_PID_FILE")
        echo -e "  Backend:   ${GREEN}● Running${NC} (PID $bpid) → http://localhost:$BACKEND_PORT"
    else
        echo -e "  Backend:   ${RED}● Stopped${NC}"
    fi

    # Frontend
    if is_running "frontend"; then
        local fpid=$(cat "$FRONTEND_PID_FILE")
        local actual_port
        actual_port=$(grep -oP 'localhost:\K[0-9]+' "$LOG_DIR/frontend.log" 2>/dev/null | head -1)
        actual_port="${actual_port:-$FRONTEND_PORT}"
        echo -e "  Frontend:  ${GREEN}● Running${NC} (PID $fpid) → http://localhost:$actual_port"
    else
        echo -e "  Frontend:  ${RED}● Stopped${NC}"
    fi

    echo ""
    echo -e "  ${CYAN}Logs:${NC}      $LOG_DIR/"
    echo -e "  ${CYAN}Backend:${NC}   $LOG_DIR/backend.log"
    echo -e "  ${CYAN}Frontend:${NC}  $LOG_DIR/frontend.log"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ─── Logs ─────────────────────────────────────────────────────────────────────

show_logs() {
    local service="${1:-all}"

    case "$service" in
        backend)
            echo -e "${CYAN}─── Backend Logs ───${NC}"
            tail -50 "$LOG_DIR/backend.log" 2>/dev/null || echo "No backend logs yet"
            ;;
        frontend)
            echo -e "${CYAN}─── Frontend Logs ───${NC}"
            tail -50 "$LOG_DIR/frontend.log" 2>/dev/null || echo "No frontend logs yet"
            ;;
        all|*)
            echo -e "${CYAN}─── Backend Logs (last 25 lines) ───${NC}"
            tail -25 "$LOG_DIR/backend.log" 2>/dev/null || echo "No backend logs yet"
            echo ""
            echo -e "${CYAN}─── Frontend Logs (last 25 lines) ───${NC}"
            tail -25 "$LOG_DIR/frontend.log" 2>/dev/null || echo "No frontend logs yet"
            ;;
    esac
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
    ensure_dirs

    case "${1:-}" in
        start)
            echo ""
            echo -e "${BLUE}Starting Guardrails Platform...${NC}"
            echo ""
            start_backend "false"
            start_frontend "false"
            echo ""
            show_status
            ;;

        stop)
            echo ""
            echo -e "${BLUE}Stopping Guardrails Platform...${NC}"
            echo ""
            stop_backend
            stop_frontend
            echo ""
            log_info "All services stopped"
            ;;

        restart)
            echo ""
            echo -e "${BLUE}Restarting Guardrails Platform...${NC}"
            echo ""
            stop_backend
            stop_frontend
            sleep 2
            start_backend "false"
            start_frontend "false"
            echo ""
            show_status
            ;;

        verbose)
            echo ""
            echo -e "${BLUE}Starting Guardrails Platform (verbose mode)...${NC}"
            echo -e "${YELLOW}All output will be printed to terminal${NC}"
            echo ""
            start_backend "true"
            start_frontend "true"
            echo ""
            show_status
            echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
            # Wait for interrupt
            trap "stop_backend; stop_frontend; exit 0" INT TERM
            wait
            ;;

        status)
            show_status
            ;;

        logs)
            show_logs "${2:-all}"
            ;;

        *)
            echo ""
            echo -e "${BLUE}Guardrails Platform Manager${NC}"
            echo ""
            echo "Usage: $0 {command}"
            echo ""
            echo "Commands:"
            echo "  start     Start backend and frontend (background)"
            echo "  stop      Stop all services"
            echo "  restart   Restart all services"
            echo "  verbose   Start with all output printed to terminal"
            echo "  status    Show running status of all services"
            echo "  logs      Show recent logs (optionally: logs backend|frontend)"
            echo ""
            echo "Examples:"
            echo "  $0 start          # Start in background"
            echo "  $0 verbose        # Start with live output"
            echo "  $0 restart        # Restart everything"
            echo "  $0 logs backend   # View backend logs"
            echo "  $0 status         # Check what's running"
            echo ""
            echo "Ports:"
            echo "  Backend:  http://localhost:$BACKEND_PORT"
            echo "  Frontend: http://localhost:$FRONTEND_PORT"
            echo "  API Docs: http://localhost:$BACKEND_PORT/docs"
            echo ""
            ;;
    esac
}

main "$@"
