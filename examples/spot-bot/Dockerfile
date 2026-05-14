FROM node:22.22.2-bookworm-slim
WORKDIR /app
ENV NODE_OPTIONS=--experimental-strip-types
COPY package.json package-lock.json ./
COPY tsconfig.json *.ts ./
RUN npm ci --omit=dev \
	&& chown -R node:node /app
USER node
CMD ["node", "bot.strategy.ts"]
