FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
RUN mkdir -p /var/data
EXPOSE 3000
CMD ["npm", "start"]
