# Use a Node.js base image
FROM node:18-slim

# Install system dependencies (ARM GCC compiler and Make for firmware builds,
# host GCC for the Learn-mode grader which compiles+runs plain host C)
RUN apt-get update && apt-get install -y \
    gcc-arm-none-eabi \
    binutils-arm-none-eabi \
    libnewlib-arm-none-eabi \
    gcc \
    make \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged, no-login user the Learn-mode grader drops to before compiling
# or running student-submitted C (see backend/learnRunner.js)
RUN useradd -u 1500 -M -s /usr/sbin/nologin learnrunner

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --production

# Copy everything (it already includes template and components in source/)
COPY . .

# Set environment variables for internal paths
ENV TEMPLATE_DIR=/app/source/template
ENV COMPONENTS_DIR=/app/source/components

# Create a temporary directory for compilation tasks
RUN mkdir -p /tmp/apm32_builds && chmod 777 /tmp/apm32_builds

# Expose the API port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
