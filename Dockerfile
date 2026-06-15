# Stage 1: Build the Angular frontend
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve the backend and frontend
FROM node:24-alpine
WORKDIR /app

# Create data directory for persistent SQLite database
RUN mkdir -p /app/data

# Copy backend dependencies and files
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=builder /app/dist/jeopardy-app/ ./dist/jeopardy-app/

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production
ENV DATABASE_DIR=/app/data
EXPOSE 3000

# Start backend server
CMD ["node", "backend/server.js"]
