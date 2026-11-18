FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
WORKDIR /app
# Prisma needs OpenSSL in both the generator and the runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx --no-install prisma generate && npm run build

FROM builder AS migrator
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "scripts/runtime-config.cjs"]
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM base AS runner
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY scripts/runtime-config.cjs ./scripts/runtime-config.cjs
USER node
EXPOSE 3001
ENTRYPOINT ["node", "scripts/runtime-config.cjs"]
CMD ["node", "dist/main.js"]
