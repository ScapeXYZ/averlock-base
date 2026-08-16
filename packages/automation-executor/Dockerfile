FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/automation-executor/package.json packages/automation-executor/package.json
RUN npm ci --omit=dev --workspace @averlock/automation-executor
COPY packages/automation-executor packages/automation-executor
WORKDIR /app/packages/automation-executor
ENV AVERLOCK_EXECUTOR_ENABLED=false AVERLOCK_EXECUTOR_DRY_RUN=true
CMD ["node", "src/server.mjs"]
