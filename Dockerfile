FROM node:10-slim
WORKDIR /app
COPY . .
RUN npm install --production
RUN npm install -g @zeit/ncc
RUN ncc build index.js -o dist
RUN rm -rf node_modules
CMD ["node", "dist/index.js"]
