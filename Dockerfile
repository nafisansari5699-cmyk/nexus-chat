# ── Nexus communication app ────────────────────────────────────
FROM node:20-alpine

# run as non-root
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# app code
COPY . .

RUN mkdir -p data uploads && chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/uploads

EXPOSE 3000

# persist chat DB + encrypted media across restarts
VOLUME ["/app/data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
