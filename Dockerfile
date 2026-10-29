FROM node:20-alpine
WORKDIR /app
COPY mafia_online_project/package*.json ./
RUN npm install --omit=dev
COPY mafia_online_project/ ./
ENV NODE_ENV=production
EXPOSE 10000
CMD ["npm", "start"]
