FROM apify/actor-node-playwright-chrome:16
COPY package*.json ./
RUN npm ci
COPY . ./
CMD ./start_xvfb_and_run_cmd.sh && npm start
