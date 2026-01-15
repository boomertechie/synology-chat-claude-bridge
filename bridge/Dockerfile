# Synology Chat Bridge - Docker Image
FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (no native modules needed - using bun:sqlite)
RUN bun install --production || bun install

# Copy source code
COPY src ./src

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 3456

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3456/health || exit 1

CMD ["bun", "run", "src/index.ts"]
