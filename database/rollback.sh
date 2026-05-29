#!/bin/bash
# =============================================================================
# Database Rollback Script
# Description: Drop all tables and reset database
# WARNING: This will delete all data!
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load environment variables
if [ -f ../.env ]; then
    export $(cat ../.env | grep -v '^#' | xargs)
fi

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-mentorminds}
DB_USER=${DB_USER:-postgres}

echo -e "${RED}==============================================================================${NC}"
echo -e "${RED}WARNING: DATABASE ROLLBACK${NC}"
echo -e "${RED}==============================================================================${NC}"
echo ""
echo "This will DROP ALL TABLES and DELETE ALL DATA from:"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo ""
echo -e "${YELLOW}Are you sure you want to continue? (type 'yes' to confirm)${NC}"
read -r confirmation

if [ "$confirmation" != "yes" ]; then
    echo "Rollback cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}Rolling back database...${NC}"

PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << EOF
-- Drop all tables in reverse order
DROP TABLE IF EXISTS schema_migrations CASCADE;
DROP TABLE IF EXISTS review_reports CASCADE;
DROP TABLE IF EXISTS review_votes CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS booking_notes CASCADE;
DROP TABLE IF EXISTS booking_participants CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS transaction_events CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS wallet_balances CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS system_configs CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop views
DROP VIEW IF EXISTS v_upcoming_bookings CASCADE;
DROP VIEW IF EXISTS v_mentor_booking_stats CASCADE;
DROP VIEW IF EXISTS v_user_transaction_summary CASCADE;
DROP VIEW IF EXISTS v_active_mentors CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_platform_statistics() CASCADE;
DROP FUNCTION IF EXISTS get_user_wallet_balance(UUID, VARCHAR) CASCADE;
DROP FUNCTION IF EXISTS set_booking_completion_timestamp() CASCADE;
DROP FUNCTION IF EXISTS set_transaction_timestamps() CASCADE;
DROP FUNCTION IF EXISTS validate_booking_times() CASCADE;
DROP FUNCTION IF EXISTS log_transaction_status_change() CASCADE;
DROP FUNCTION IF EXISTS update_user_session_count() CASCADE;
DROP FUNCTION IF EXISTS update_review_helpful_counts() CASCADE;
DROP FUNCTION IF EXISTS update_user_rating_stats() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Drop enums
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS booking_status CASCADE;
DROP TYPE IF EXISTS transaction_status CASCADE;
DROP TYPE IF EXISTS transaction_type CASCADE;
DROP TYPE IF EXISTS wallet_status CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Drop extensions (optional - comment out if you want to keep them)
-- DROP EXTENSION IF EXISTS pgcrypto CASCADE;
EOF

echo ""
echo -e "${RED}✓ Database rolled back successfully${NC}"
echo -e "${RED}All tables, views, functions, and types have been dropped${NC}"
echo ""

exit 0
