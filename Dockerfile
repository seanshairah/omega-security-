# Omega Protection Services portal — production image built from Next.js standalone output.
# Build:  docker build -t omega-portal .
# Run:    docker run -p 3000:3000 --env-file .env.production omega-portal
# Secrets (DATABASE_URL, AUTH_SECRET, SMS_*, VAPID_*) are passed at run time, never baked in.
# Migrations are applied from outside the container: `npx prisma migrate deploy` (or scripts/neon-migrate.ts).

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
# npm ci needs package.json and package-lock.json in sync; keep them committed together.
RUN npm ci --ignore-scripts && npx prisma generate

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only: the build does not connect to the database.
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL="postgresql://build:build@localhost:5432/build" DATABASE_OVER_HTTP=false AUTH_SECRET="build-time-placeholder-not-used-at-runtime-0000"
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
