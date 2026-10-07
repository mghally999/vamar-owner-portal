# Firebase emulator image: Node + Java (the Auth emulator is a JVM program).
FROM node:24-alpine
RUN apk add --no-cache openjdk21-jre-headless bash wget \
  && npm install -g firebase-tools@15 \
  && mkdir -p /app/data
WORKDIR /app
EXPOSE 9099 4000
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-vamar", \
     "--import", "/app/data", "--export-on-exit", "/app/data"]
