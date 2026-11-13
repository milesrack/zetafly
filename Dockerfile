FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
RUN --mount=type=cache,id=zetafly-npm,target=/root/.npm,sharing=locked npm ci --no-audit

FROM dependencies AS model-data
COPY server/brain/graph.ts ./server/brain/graph.ts
COPY scripts/fetch-model.ts ./scripts/fetch-model.ts
COPY models/connectome.json ./models/connectome.json
RUN npm run model:fetch
RUN mkdir /app/model-data && cp research/data/neurons.csv research/data/graph.json research/data/*.bin /app/model-data/

FROM dependencies AS web-build
COPY tsconfig.json LICENSE NOTICE ./
COPY shared ./shared
COPY server ./server
COPY scripts ./scripts
COPY tests ./tests
COPY models ./models
COPY research ./research
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production HOST=0.0.0.0 PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
RUN --mount=type=cache,id=zetafly-npm,target=/root/.npm,sharing=locked npm ci --omit=dev --no-audit
RUN --mount=type=cache,id=zetafly-npm,target=/root/.npm,sharing=locked npx --no-install playwright install --with-deps chromium
COPY shared ./shared
COPY server ./server
COPY models ./models
COPY LICENSE NOTICE ./
COPY --from=model-data /app/model-data ./research/data
COPY --from=web-build /app/web/dist ./web/dist
USER node
EXPOSE 3000
CMD ["node","server/index.ts"]
