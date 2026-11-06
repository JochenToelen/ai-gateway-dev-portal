FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Entra app registration is baked in at build time, e.g. --build-arg VITE_AZURE_CLIENT_ID=...
ARG VITE_AZURE_CLIENT_ID
ENV VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8080
CMD ["node", "server/server.mjs"]
