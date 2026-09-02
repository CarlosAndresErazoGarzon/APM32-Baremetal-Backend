# Use a Node.js base image
FROM node:18-slim

# Install system dependencies (ARM GCC compiler and Make for firmware builds,
# host GCC for the Learn-mode grader which compiles+runs plain host C).
# --no-install-recommends: without it, apt pulls in a surprising amount of
# unrelated stuff transitively (X11/image/codec libs -- libgd3, libheif1,
# libx265, etc.) that this headless compile-only container never touches,
# ballooning the image from ~350MB to ~3.9GB (verified). libc6-dev is
# listed explicitly because of that same flag: on this base image it's
# only a *Recommends* of gcc, not a hard Depends, so --no-install-
# recommends silently drops it -- and without it, linking any host C
# program fails ("cannot find Scrt1.o/crti.o") because gcc itself installs
# fine without ever needing the actual C runtime startup objects. Verified
# (host gcc compile+link+run, ARM cross-compile of the real firmware
# template, and the learnrunner uid-drop + ulimit sandboxing) against this
# exact package list before landing it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc-arm-none-eabi \
    binutils-arm-none-eabi \
    libnewlib-arm-none-eabi \
    gcc \
    libc6-dev \
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
