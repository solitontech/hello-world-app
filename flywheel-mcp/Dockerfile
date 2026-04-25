FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
EXPOSE 5501
ENV MCP_MODE=http
ENV PORT=5501
CMD ["node", "dist/index.js"]
