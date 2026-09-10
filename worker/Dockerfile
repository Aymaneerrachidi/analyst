FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx esbuild worker/stalkchain.ts --bundle --platform=node --packages=external --format=esm --outfile=dist/worker.mjs

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV ANALYST_WORKER=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
USER node
CMD ["node", "--conditions=react-server", "dist/worker.mjs"]
