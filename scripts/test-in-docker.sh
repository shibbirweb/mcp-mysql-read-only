#!/bin/bash
#
# Run the full test suite without installing anything on the host.
#
# Starts a throwaway MySQL container, builds the test image, runs the suite
# against it, then tears everything down. Your own MySQL is never touched.
#
# Usage: ./scripts/test-in-docker.sh [extra args passed to node --test]
set -euo pipefail

NETWORK="mcp-mysql-ro-test-net"
MYSQL_CONTAINER="mcp-mysql-ro-test-db"
TEST_IMAGE="mcp-mysql-read-only:test"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"
ROOT_PASSWORD="test_root_pw"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  docker rm -f "$MYSQL_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker network create "$NETWORK" >/dev/null

echo "==> starting $MYSQL_IMAGE"
docker run -d --name "$MYSQL_CONTAINER" --network "$NETWORK" \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PASSWORD" \
  "$MYSQL_IMAGE" \
  --default-authentication-plugin=mysql_native_password >/dev/null

echo "==> waiting for MySQL to accept connections"
for attempt in $(seq 1 60); do
  if docker exec "$MYSQL_CONTAINER" mysqladmin ping -h 127.0.0.1 -u root -p"$ROOT_PASSWORD" --silent >/dev/null 2>&1; then
    echo "    ready after ${attempt}s"
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "MySQL did not become ready in time" >&2
    docker logs "$MYSQL_CONTAINER" >&2
    exit 1
  fi
  sleep 1
done

echo "==> building test image"
docker build --target test -t "$TEST_IMAGE" "$REPO_DIR"

echo "==> running tests"
docker run --rm --network "$NETWORK" \
  -e TEST_MYSQL_HOST="$MYSQL_CONTAINER" \
  -e TEST_MYSQL_PORT=3306 \
  -e TEST_MYSQL_USER=root \
  -e TEST_MYSQL_PASSWORD="$ROOT_PASSWORD" \
  "$TEST_IMAGE" \
  node --test "$@"
