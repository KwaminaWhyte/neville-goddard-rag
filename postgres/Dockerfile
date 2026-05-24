# Postgres 16 with Apache AGE (graph) + pgvector (vectors) for LightRAG.
# apache/age is built on the official postgres image, so the PGDG apt repo is
# present and pgvector installs cleanly.
FROM apache/age:release_PG18_1.7.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-pgvector \
    && rm -rf /var/lib/apt/lists/*

# Create both extensions on first init.
COPY init.sql /docker-entrypoint-initdb.d/00-extensions.sql
