FROM node:22-alpine
RUN apk add --no-cache ffmpeg tzdata
WORKDIR /app
COPY server.mjs .
CMD ["node", "server.mjs"]
