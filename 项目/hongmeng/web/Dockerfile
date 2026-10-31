FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /workspace/web
COPY web/package*.json ./
RUN npm ci --ignore-scripts
COPY entry/src/main/ets/model /workspace/entry/src/main/ets/model
COPY entry/src/main/ets/services/FeedParsers.ets /workspace/entry/src/main/ets/services/FeedParsers.ets
COPY entry/src/main/ets/data/OfficialSources.ets /workspace/entry/src/main/ets/data/OfficialSources.ets
COPY web/scripts ./scripts
COPY web/public ./public
RUN npm run build
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /workspace/web/dist ./dist
COPY --chown=node:node web/server ./server
RUN mkdir /app/data /app/catalog && chown node:node /app/data /app/catalog
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.mjs"]
