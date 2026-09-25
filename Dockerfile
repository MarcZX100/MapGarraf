FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG VITE_TILE_URL
ENV VITE_TILE_URL=${VITE_TILE_URL}
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4173 DATABASE_PATH=/app/data/busgarraf.sqlite TRUST_PROXY=0
WORKDIR /app
COPY package*.json ./
RUN mkdir -p /app/data && chown -R node:node /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
USER node
VOLUME ["/app/data"]
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
