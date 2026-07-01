# Use light Node 24 alpine image
FROM node:24-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy service code
COPY . .

# Expose port
EXPOSE 8080

# Configure environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Start the service
CMD [ "npm", "start" ]
