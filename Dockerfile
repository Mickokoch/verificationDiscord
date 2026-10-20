# --- Compilation ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts : better-sqlite3 fournit des binaires précompilés (x64 et arm64),
# pas besoin de compiler quoi que ce soit.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts && rm -f dist/*.test.js dist/*.test.js.map

# --- Exécution ---
FROM node:24-slim
ENV NODE_ENV=production \
    DB_PATH=/data/verification.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
