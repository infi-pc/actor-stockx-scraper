FROM apify/actor-node-playwright-chrome:16
COPY package*.json ./
RUN npm ci
COPY . ./
CMD npm start
