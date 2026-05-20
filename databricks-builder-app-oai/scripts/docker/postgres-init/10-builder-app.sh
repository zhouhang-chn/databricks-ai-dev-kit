#!/bin/sh
set -eu

schema="${APP_DB_SCHEMA:-builder_app}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_db="$POSTGRES_DB" \
  -v app_user="$POSTGRES_USER" \
  -v app_schema="$schema" <<'SQL'
CREATE SCHEMA IF NOT EXISTS :"app_schema" AUTHORIZATION :"app_user";
GRANT USAGE, CREATE ON SCHEMA :"app_schema" TO :"app_user";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA :"app_schema" TO :"app_user";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA :"app_schema" TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"app_schema" GRANT ALL ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"app_schema" GRANT ALL ON SEQUENCES TO :"app_user";
ALTER ROLE :"app_user" IN DATABASE :"app_db" SET search_path = :"app_schema", public;
SQL
