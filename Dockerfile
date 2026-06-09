# Build the client and run the Express server (serves API + static client).
FROM node:22-alpine

WORKDIR /app
COPY . .

# Installs server + client deps (via root postinstall) and builds the client.
RUN npm install && npm run build

ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
