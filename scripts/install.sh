#!/bin/bash
# Synology Chat Executor - Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="synology-chat-executor"

echo "Installing Synology Chat ↔ Claude Code Integration"
echo "=================================================="

# Check prerequisites
echo ""
echo "Checking prerequisites..."

if ! command -v bun &> /dev/null; then
    echo "ERROR: Bun not found. Install from https://bun.sh"
    exit 1
fi
echo "  ✓ Bun installed"

if ! command -v claude &> /dev/null; then
    echo "ERROR: Claude Code CLI not found"
    exit 1
fi
echo "  ✓ Claude CLI installed"

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$PROJECT_DIR"
bun install

# Create directories
mkdir -p sessions logs

# Generate auth token if .env doesn't exist
if [ ! -f config/.env ]; then
    echo ""
    echo "Creating .env file..."
    AUTH_TOKEN=$(openssl rand -hex 32)

    cat > config/.env << EOF
# Synology Chat Executor Configuration
# Generated: $(date -Iseconds)

BRIDGE_AUTH_TOKEN=${AUTH_TOKEN}
PAI_DIR=${HOME}/.claude
CLAUDE_CLI_PATH=$(which claude)
PORT=3457
LOG_LEVEL=info
EOF

    echo ""
    echo "============================================="
    echo "IMPORTANT: Save this auth token for the Bridge!"
    echo "TOKEN: ${AUTH_TOKEN}"
    echo "============================================="
else
    echo ""
    echo "  ✓ .env already exists"
fi

# Create systemd service
echo ""
echo "Creating systemd service..."

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ -f "$SERVICE_FILE" ]; then
    echo "  Service file already exists. Updating..."
fi

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Claude Code Executor for Synology Chat
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/config/.env
ExecStart=$(which bun) run src/server.ts
Restart=always
RestartSec=10
StandardOutput=append:${PROJECT_DIR}/logs/executor.log
StandardError=append:${PROJECT_DIR}/logs/executor.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo ""
echo "============================================="
echo "Installation complete!"
echo ""
echo "Commands:"
echo "  Start:   sudo systemctl start $SERVICE_NAME"
echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
echo "  Status:  sudo systemctl status $SERVICE_NAME"
echo "  Logs:    tail -f ${PROJECT_DIR}/logs/executor.log"
echo ""
echo "Test the server:"
echo "  curl http://localhost:3457/health"
echo "============================================="
