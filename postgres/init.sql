-- Enable both extensions LightRAG needs. Runs once on a fresh data dir.
CREATE EXTENSION IF NOT EXISTS age;
CREATE EXTENSION IF NOT EXISTS vector;
LOAD 'age';
