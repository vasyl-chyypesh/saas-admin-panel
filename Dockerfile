# syntax=docker/dockerfile:1

# ---- Stage 1: full dependency tree (dev deps needed to build) ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build both halves ----
FROM node:26-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Produces dist/ui (Vite) and dist/api (tsc).
RUN npm run build

# ---- Stage 3: production dependencies only ----
FROM node:26-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 4: runtime ----
FROM node:26-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000

# No secrets are baked in. Oncade is optional; pass its variables at run time:
#   docker run -e ONCADE_API_KEY=... -e ONCADE_BUSINESS_ID=... -p 3000:3000 saas-admin-panel
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/api/server.js"]
