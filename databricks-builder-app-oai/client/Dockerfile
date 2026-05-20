FROM node:22-alpine AS build

WORKDIR /app/client

RUN corepack enable \
  && corepack prepare pnpm@10.10.0 --activate

COPY databricks-builder-app-oai/client/package.json databricks-builder-app-oai/client/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY databricks-builder-app-oai/client ./
RUN pnpm build

FROM nginx:1.27-alpine

ENV FRONTEND_PORT=8080
ENV BACKEND_URL=http://builder-app-oai-backend:8000

COPY databricks-builder-app-oai/client/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/client/out /usr/share/nginx/html

EXPOSE 8080
