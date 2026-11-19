FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /app/backend
COPY backend/pom.xml ./
COPY backend/src ./src
COPY --from=frontend /app/frontend/dist /app/frontend/dist
RUN mvn -B package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=backend --chown=10001:10001 /app/backend/target/caro-online.jar ./caro-online.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/caro-online.jar"]
