# Imagen lista para publicar la app en un servidor (incluye LibreOffice para los PDF).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-calc fonts-dejavu fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
