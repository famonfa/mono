FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV PORT=8080 DB_PATH=/data/relay.db NODE_NO_WARNINGS=1
EXPOSE 8080
CMD ["node", "src/main.mjs"]
