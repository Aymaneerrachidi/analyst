FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx esbuild worker/index.ts --bundle --platform=node --packages=external --format=esm --outfile=dist/worker.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV ANALYST_WORKER=1
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
USER node
CMD ["node", "--conditions=react-server", "dist/worker.mjs"]
