FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:24-alpine AS backend-base
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ .
COPY --from=frontend /app/frontend/dist ./public
RUN apk add --no-cache curl \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup

FROM backend-base AS pull-worker
USER root
RUN apk add --no-cache ffmpeg
USER appuser
CMD ["node", "pull-worker.js"]

FROM backend-base AS web
USER appuser
EXPOSE 3001
CMD ["node", "server.js"]
