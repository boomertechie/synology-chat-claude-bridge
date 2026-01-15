# Synology Chat ↔ Claude Code Integration

Bidirectional integration enabling chat-based interaction with Claude Code from Synology Chat. Supports session continuity and works with Claude Code's built-in features including tools, skills, and hooks.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SYNOLOGY NAS                           │
│                                                             │
│   Synology Chat ──► Outgoing Webhook ──┐                   │
│        ▲                                │                   │
│        │                                ▼                   │
│   Incoming Webhook ◄── Chat Bridge (Docker, port 3456)     │
│                              │                              │
└──────────────────────────────┼──────────────────────────────┘
                               │ HTTP (LAN)
┌──────────────────────────────▼──────────────────────────────┐
│                    CLAUDE CODE MACHINE                      │
│                                                             │
│   Executor Service (systemd, port 3457)                    │
│        │                                                    │
│        ▼                                                    │
│   Claude Code CLI                                          │
│   (Full access to tools, skills, hooks)                    │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Executor Service (Local Machine)

Runs on the machine with Claude Code installed. Accepts HTTP requests and spawns `claude -p` to process prompts.

- **Location:** `~/.claude/integrations/synology-chat/`
- **Port:** 3457
- **Service:** `synology-chat-executor.service`

**Features:**
- Session continuity via `--continue` flag
- Request queue (max 2 concurrent)
- Auto-approved tools: Read, Grep, Glob, Edit, Write
- Full Claude Code integration

### Chat Bridge (Synology NAS)

Docker container that receives webhooks from Synology Chat, forwards to the Executor, and sends responses back.

- **Location:** `/volume1/docker/claude-chat-bridge/`
- **Port:** 3456
- **Image:** `claude-bridge-bridge:latest`

**Features:**
- SQLite session storage
- Rate limiting (0.5s between messages)
- Webhook token validation
- Message chunking for long responses

## Installation

### Prerequisites

- Synology NAS with Container Manager (Docker)
- Linux machine with Claude Code CLI installed
- Both devices on same LAN
- Bun runtime on both machines

### Step 1: Set Up Executor (Claude Machine)

```bash
# Navigate to integration directory
cd ~/.claude/integrations/synology-chat

# Install dependencies
bun install

# Create required directories
mkdir -p sessions logs

# Configure environment
cat > config/.env << 'EOF'
BRIDGE_AUTH_TOKEN=<generate-with-openssl-rand-hex-32>
PAI_DIR=/home/YOUR_USER/.claude
PORT=3457
LOG_LEVEL=info
EOF

# Apply SELinux context (Fedora/RHEL)
sudo chcon -t etc_t ~/.claude/integrations/synology-chat/config/.env
sudo chcon -t bin_t ~/.bun/bin/bun
sudo chcon -t bin_t ~/.local/bin/bun
```

### Step 2: Create Systemd Service

```bash
# Create service file (adjust paths and username)
echo '[Unit]
Description=Claude Code Executor for Synology Chat
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/.claude/integrations/synology-chat
EnvironmentFile=/home/YOUR_USERNAME/.claude/integrations/synology-chat/config/.env
Environment="PATH=/home/YOUR_USERNAME/.local/bin:/home/YOUR_USERNAME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/home/YOUR_USERNAME/.bun/bin/bun run src/server.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target' | sudo tee /etc/systemd/system/synology-chat-executor.service

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable synology-chat-executor
sudo systemctl start synology-chat-executor

# Verify
sudo systemctl status synology-chat-executor
curl http://localhost:3457/health
```

### Step 3: Open Firewall Port

```bash
# Fedora/RHEL
sudo firewall-cmd --add-port=3457/tcp --permanent
sudo firewall-cmd --reload
```

### Step 4: Set Up Bridge (Synology)

1. **Create Synology Chat Webhooks:**
   - Open Synology Chat → Integration
   - Create **Incoming Webhook** (for sending responses)
     - Note the webhook URL
   - Create **Outgoing Webhook** (for receiving messages)
     - URL: `http://YOUR_NAS_IP:3456/webhook`
     - Trigger: Messages containing `@claude`
     - Note the auto-generated token

2. **Copy Bridge files to Synology:**
   ```bash
   scp -r ~/.claude/integrations/synology-chat/bridge/* \
     YOUR_NAS:/volume1/docker/claude-chat-bridge/
   ```

3. **Create Bridge config on Synology:**
   ```bash
   # SSH to Synology
   ssh YOUR_NAS
   cd /volume1/docker/claude-chat-bridge

   cat > config/.env << 'EOF'
   SYNOLOGY_WEBHOOK_URL=https://YOUR_NAS:5001/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=YOUR_INCOMING_TOKEN
   SYNOLOGY_WEBHOOK_TOKEN=YOUR_OUTGOING_WEBHOOK_TOKEN
   EXECUTOR_URL=http://CLAUDE_MACHINE_IP:3457
   EXECUTOR_AUTH_TOKEN=SAME_TOKEN_AS_BRIDGE_AUTH_TOKEN
   PORT=3456
   EOF
   ```

4. **Build and run:**
   ```bash
   # Build image
   docker build -t claude-bridge-bridge .

   # Run container
   docker run -d \
     --name claude-chat-bridge \
     --restart unless-stopped \
     --env-file /volume1/docker/claude-chat-bridge/config/.env \
     -p 3456:3456 \
     -v /volume1/docker/claude-chat-bridge/data:/app/data \
     claude-bridge-bridge:latest

   # Verify
   docker logs claude-chat-bridge
   ```

## Usage

### Basic Commands

| Command | Description |
|---------|-------------|
| `@claude <message>` | Send a message to Claude |
| `@claude reset` | Start a new session |
| `@claude status` | Show session info |
| `@claude help` | Show help |

### Examples

```
@claude what is the capital of France?
@claude summarize the last 5 git commits
@claude help me write a bash script to find large files
@claude reset
```

### Session Behavior

- Sessions are per-user, per-channel
- 30-minute timeout for inactivity
- Use `@claude reset` to start fresh
- Sessions persist across service restarts (SQLite storage)

## Configuration Reference

### Executor Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BRIDGE_AUTH_TOKEN` | Yes | - | Shared secret for authentication |
| `PAI_DIR` | No | ~/.claude | Path to Claude Code config directory |
| `PORT` | No | 3457 | HTTP server port |
| `LOG_LEVEL` | No | info | Logging verbosity |

### Bridge Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SYNOLOGY_WEBHOOK_URL` | Yes | - | Incoming webhook URL |
| `SYNOLOGY_WEBHOOK_TOKEN` | No | - | Outgoing webhook token for validation |
| `EXECUTOR_URL` | Yes | - | URL to Executor service |
| `EXECUTOR_AUTH_TOKEN` | Yes | - | Must match Executor's BRIDGE_AUTH_TOKEN |
| `PORT` | No | 3456 | HTTP server port |

## Troubleshooting

### Executor Issues

**Service won't start (SELinux):**
```bash
# Check for AVC denials
sudo ausearch -m avc -ts recent

# Fix common SELinux issues
sudo chcon -t etc_t ~/.claude/integrations/synology-chat/config/.env
sudo chcon -t bin_t ~/.bun/bin/bun
sudo chcon -t bin_t ~/.local/bin/claude
```

**"Executable not found in $PATH: claude":**
```bash
# Ensure PATH is set in systemd service
Environment="PATH=/home/USER/.local/bin:/home/USER/.bun/bin:/usr/local/bin:/usr/bin:/bin"
```

**Check logs:**
```bash
sudo journalctl -u synology-chat-executor -f
```

### Bridge Issues

**Container exits immediately:**
- Check environment variables are set
- Run interactively to see errors:
  ```bash
  docker run --rm -it --env-file config/.env claude-bridge-bridge:latest
  ```

**Can't reach Executor:**
- Verify firewall is open on Claude machine
- Test connectivity: `curl http://EXECUTOR_IP:3457/health`

**Check logs:**
```bash
docker logs claude-chat-bridge
```

### Connection Issues

**Bridge can't reach Executor:**
```bash
# From Synology, test connectivity
curl http://CLAUDE_MACHINE_IP:3457/health

# On Claude machine, check firewall
sudo firewall-cmd --list-ports
```

## Security Considerations

- **Auth Token:** 64-character random hex, shared between Bridge and Executor
- **Network:** LAN-only, no internet exposure required
- **Webhook Token:** Validates requests are from Synology Chat
- **Auto-approved Tools:** Limited to safe operations (Read, Grep, Glob, Edit, Write)

### Generating Secure Tokens

```bash
openssl rand -hex 32
```

## File Structure

### Executor (Claude Machine)

```
~/.claude/integrations/synology-chat/
├── README.md
├── package.json
├── src/
│   ├── server.ts           # HTTP server
│   ├── claude-runner.ts    # Spawns claude CLI
│   ├── session-manager.ts  # JSON session storage
│   ├── queue.ts            # Concurrency limiter
│   └── types.ts
├── config/
│   └── .env
├── sessions/               # Session JSON files
└── scripts/
    └── install.sh
```

### Bridge (Synology)

```
/volume1/docker/claude-chat-bridge/
├── Dockerfile
├── package.json
├── src/
│   ├── index.ts            # Webhook handler
│   ├── synology-client.ts  # Send to Synology
│   ├── executor-client.ts  # Send to Executor
│   ├── session-manager.ts  # SQLite sessions
│   ├── rate-limiter.ts
│   └── types.ts
├── config/
│   └── .env
└── data/
    └── sessions.sqlite
```

## Performance Notes

- **Response Time:** 3-8 seconds typical (Claude CLI startup overhead)
- **Concurrency:** Max 2 simultaneous requests
- **Rate Limiting:** 0.5s minimum between messages

## Future Enhancements

Potential improvements not yet implemented:
- Image attachment support (send images to Claude for analysis)
- File sharing (receive files from Claude)
- Multi-channel routing
- Priority queuing
- Response streaming

---

**Version:** 1.0.0
**License:** MIT
