FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY index.js ./
# COPY ZOHO_MCP_DEPLOYMENT.txt ./
# COPY .env.example ./

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV PORT=3000

EXPOSE 3000

CMD ["node", "mcpServer.js"]
