# Lucien — image de production (appli PWA + API + connecteur MCP + site vitrine)
# Étape 1 : dépendances et compilation
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --workspaces --include-workspace-root

# Étape 2 : image d'exécution, sans outils de compilation
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 LUCIEN_DATA=/data NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/scripts server/scripts
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/site site
RUN mkdir -p /data && chown -R node:node /data
USER node
WORKDIR /app/server
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
