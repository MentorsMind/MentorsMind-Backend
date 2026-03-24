#!/bin/bash
# =============================================================================
# Database Migration Script
# Description: Run all database migrations in order
# =============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f ../.env ]; then
    export $(cat ../.env | grep -v '^#' | xargs)
fi

# Database connection parameters
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-mentorminds}
DB_USER=${DB_USER:-postgres}

echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}MentorsMind Database Migration${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo ""

# Check if database exists
echo -e "${YELLOW}Checking database connection...${NC}"
if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo -e "${GREEN}✓ Database exists${NC}"
else
    echo -e "${RED}✗ Database does not exist${NC}"
    echo -e "${YELLOW}Creating database...${NC}"
    PGPASSWORD=$DB_PASSWORD createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME
    echo -e "${GREEN}✓ Database created${NC}"
fi

# Create migrations table if it doesn't exist
echo -e "${YELLOW}Setting up migrations tracking...${NC}"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
EOF
echo -e "${GREEN}✓ Migrations table ready${NC}"

# Function to run a migration
run_migration() {
    local migration_file=$1
    local migration_name=$(basename $migration_file)
    
    # Check if migration has already been run
    local already_run=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT COUNT(*) FROM schema_migrations WHERE migration_name = '$migration_name'")
    
    if [ "$already_run" -gt 0 ]; then
        echo -e "${YELLOW}⊘ Skipping $migration_name (already executed)${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}→ Running $migration_name...${NC}"
    
    if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $migration_file; then
        # Record successful migration
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "INSERT INTO schema_migrations (migration_name) VALUES ('$migration_name')"
        echo -e "${GREEN}✓ $migration_name completed${NC}"
        return 0
    else
        echo -e "${RED}✗ $migration_name failed${NC}"
        return 1
    fi
}

# Run migrations in order
echo ""
echo -e "${GREEN}Running migrations...${NC}"
echo ""

MIGRATIONS=(
    "migrations/001_create_users.sql"
    "migrations/002_create_wallets.sql"
    "migrations/003_create_transactions.sql"
    "migrations/004_create_bookings.sql"
    "migrations/005_create_reviews.sql"
    "migrations/006_create_indexes.sql"
    "migrations/007_create_triggers.sql"
)

for migration in "${MIGRATIONS[@]}"; do
    if [ -f "$migration" ]; then
        run_migration "$migration" || exit 1
    else
        echo -e "${RED}✗ Migration file not found: $migration${NC}"
        exit 1
    fi
done

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${GREEN}✓ All migrations completed successfully!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""

# Show migration history
echo -e "${YELLOW}Migration history:${NC}"
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT id, migration_name, executed_at FROM schema_migrations ORDER BY id"

exit 0
