FROM node:22-slim

# PipeWire tools so pactl works inside the container (host sockets mounted at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pipewire-pulse \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm run install:all --prefix /app
COPY . .
RUN npm run build --prefix /app

ENV PORT=4190 PIPEDECK_DATA_DIR=/app/data
EXPOSE 4190
CMD ["npm", "start"]
