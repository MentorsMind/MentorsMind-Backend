@echo off
REM =============================================================================
REM Database Migration Script (Windows)
REM Description: Run all database migrations in order
REM =============================================================================

setlocal enabledelayedexpansion

echo ==============================================================================
echo MentorsMind Database Migration
echo ==============================================================================
echo.

REM Load environment variables from .env file
if exist ..\.env (
    for /f "usebackq tokens=1,* delims==" %%a in ("..\.env") do (
        set "%%a=%%b"
    )
)

REM Set default values if not provided
if not defined DB_HOST set DB_HOST=localhost
if not defined DB_PORT set DB_PORT=5432
if not defined DB_NAME set DB_NAME=mentorminds
if not defined DB_USER set DB_USER=postgres

echo Database: %DB_NAME%
echo Host: %DB_HOST%:%DB_PORT%
echo User: %DB_USER%
echo.

REM Check if database exists
echo Checking database connection...
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -lqt | findstr /C:"%DB_NAME%" >nul
if errorlevel 1 (
    echo Database does not exist. Creating...
    createdb -h %DB_HOST% -p %DB_PORT% -U %DB_USER% %DB_NAME%
    if errorlevel 1 (
        echo Failed to create database
        exit /b 1
    )
    echo Database created successfully
) else (
    echo Database exists
)

REM Create migrations table
echo Setting up migrations tracking...
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, migration_name VARCHAR(255) NOT NULL UNIQUE, executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());"
if errorlevel 1 (
    echo Failed to create migrations table
    exit /b 1
)
echo Migrations table ready
echo.

REM Run migrations
echo Running migrations...
echo.

set MIGRATIONS=001_create_users.sql 002_create_wallets.sql 003_create_transactions.sql 004_create_bookings.sql 005_create_reviews.sql 006_create_indexes.sql 007_create_triggers.sql

for %%m in (%MIGRATIONS%) do (
    REM Check if migration already executed
    psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -tAc "SELECT COUNT(*) FROM schema_migrations WHERE migration_name = '%%m'" > temp.txt
    set /p COUNT=<temp.txt
    del temp.txt
    
    if "!COUNT!" == "0" (
        echo Running %%m...
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -f migrations\%%m
        if errorlevel 1 (
            echo Failed: %%m
            exit /b 1
        )
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "INSERT INTO schema_migrations (migration_name) VALUES ('%%m')"
        echo Completed: %%m
    ) else (
        echo Skipping %%m (already executed)
    )
)

echo.
echo ==============================================================================
echo All migrations completed successfully!
echo ==============================================================================
echo.

REM Show migration history
echo Migration history:
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "SELECT id, migration_name, executed_at FROM schema_migrations ORDER BY id"

endlocal
exit /b 0
