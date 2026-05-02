# Build context: this directory.
#   docker compose up --build
#   docker build -t trepa/example-liquidity-bot .

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_OPTIONS=--experimental-strip-types
COPY package.json package-lock.json ./
COPY tsconfig.json bot.strategy.ts bot.manager.ts utils.ts ./
RUN npm ci --omit=dev \
	&& chown -R node:node /app
USER node
CMD ["node", "bot.strategy.ts"]
