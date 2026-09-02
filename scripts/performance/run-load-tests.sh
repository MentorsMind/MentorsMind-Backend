#!/usr/bin/env bash
# scripts/performance/run-load-tests.sh
# Run load testing via K6 Docker container or local k6 binary if installed.

set -e

# Target API URL (default to local running server)
TARGET_URL=${API_URL:-"http://localhost:5001/api/v1"}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_TEST_FILE="load-tests/critical-flows.js"

echo "================================================================="
echo "🏋️  Starting MentorsMind Load Tests"
echo "Target API: $TARGET_URL"
echo "Test Script: $LOAD_TEST_FILE"
echo "================================================================="

# Check if k6 is installed locally
if command -v k6 &> /dev/null; then
  echo "🚀 Running load test using local K6 installation..."
  k6 run -e API_URL="$TARGET_URL" "$PROJECT_ROOT/$LOAD_TEST_FILE"
else
  # Use Docker if local K6 is not installed
  if command -v docker &> /dev/null; then
    echo "🐳 Running load test using Dockerised K6 (grafana/k6)..."
    
    # Check if we need to map localhost to host.docker.internal
    if [[ "$TARGET_URL" == *"localhost"* || "$TARGET_URL" == *"127.0.0.1"* ]]; then
      # Replace localhost with host.docker.internal so docker container can access it
      DOCKER_TARGET_URL=$(echo "$TARGET_URL" | sed 's/localhost/host.docker.internal/g' | sed 's/127.0.0.1/host.docker.internal/g')
      echo "⚠️ Detected localhost target. Remapped to $DOCKER_TARGET_URL for Docker network access."
      
      docker run --rm --add-host=host.docker.internal:host-gateway -i grafana/k6 run -e API_URL="$DOCKER_TARGET_URL" - < "$PROJECT_ROOT/$LOAD_TEST_FILE"
    else
      docker run --rm -i grafana/k6 run -e API_URL="$TARGET_URL" - < "$PROJECT_ROOT/$LOAD_TEST_FILE"
    fi
  else
    echo "❌ Error: Neither local 'k6' binary nor 'docker' command found."
    echo "Please install k6 (https://k6.io/docs/getting-started/installation/) or Docker."
    exit 1
  fi
fi

echo "================================================================="
echo "✅ Load testing run completed successfully."
echo "================================================================="
