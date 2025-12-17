# Snowfort Relay Server
FROM oven/bun:1.2 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Run relay server
EXPOSE 8080
ENV NODE_ENV=production
CMD ["bun", "run", "src/relay/index.ts"]
