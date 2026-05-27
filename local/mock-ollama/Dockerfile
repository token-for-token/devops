# Minimal mock Ollama HTTP server for E2E tests — returns a canned
# `/api/chat`-shaped completion regardless of input. The t4t-provider treats
# this as its inference backend; no GPU needed.
FROM oven/bun:1.2-alpine
WORKDIR /app
COPY server.ts ./server.ts
EXPOSE 11434
CMD ["bun", "run", "server.ts"]
