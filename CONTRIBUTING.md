# Contributing to MentorMinds Backend

We follow a consistent development workflow to ensure high-quality code and smooth collaboration.

## Branch Naming Conventions
- **feature/** - For new features (e.g., `feature/issue-10-user-authentication`)
- **bugfix/** - For bug fixes (e.g., `bugfix/issue-5-fix-login-error`)
- **refactor/** - For code refactoring (e.g., `refactor/api-response-handler`)
- **docs/** - For documentation changes

## PR Conventions
- **PR Title**: `[Issue #X] Description`
- **PR Description**: Mention the issue number it closes/fixes.
- **Review**: At least one approval is required before merging.

## PR Checklist
- [ ] Branch follows naming convention
- [ ] Linting and formatting pass (`npm run lint` and `npm run format`)
- [ ] TypeScript build passes (`npm run build`)
- [ ] Tests pass (`npm run test`)
- [ ] Documentation updated if necessary

## Development Workflow
1. Create a branch from `main`.
2. Commit your changes.
3. Push to your fork or the main repository.
4. Open a PR.
5. Ensure linting and tests pass.

## Code Style
- Use TypeScript strict mode.
- Use ESLint and Prettier (enforced via pre-commit hooks).
- Prefer async/await over callbacks.
- Use Zod for validation.

## Database Migrations

We use `node-pg-migrate` for database schema versioning and migrations.

### Migration Commands

```bash
# Run pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Check migration status
npm run migrate:status

# Create a new migration
npm run migrate:create <migration-name>
```

### Migration Workflow

1. **Development**: Migrations run automatically on server startup in development mode
2. **Production**: Run migrations as a separate pre-deploy step:
   ```bash
   npm run migrate:up
   ```
3. **CI/CD**: Migrations run automatically before integration tests

### Creating Migrations

1. Create a new migration file:
   ```bash
   npm run migrate:create add_new_feature
   ```

2. Edit the generated file in `database/migrations/`

3. Implement both `up` and `down` functions:
   ```javascript
   exports.up = (pgm) => {
     pgm.createTable('my_table', {
       id: 'id',
       name: { type: 'varchar(100)', notNull: true },
       created_at: { type: 'timestamp', default: pgm.func('NOW()') }
     });
   };

   exports.down = (pgm) => {
     pgm.dropTable('my_table');
   };
   ```

### Migration Best Practices

- Always provide both `up` and `down` migrations
- Test migrations locally before committing
- Use transactions for data migrations
- Never modify existing migrations that have been deployed
- Use descriptive migration names
- Add indexes for foreign keys and frequently queried columns
- Document complex migrations with comments

### Migration Lock

A lock table prevents concurrent migration runs. If a migration fails:
1. Check the error in logs
2. Fix the issue
3. Run `npm run migrate:down` if needed
4. Run `npm run migrate:up` again

