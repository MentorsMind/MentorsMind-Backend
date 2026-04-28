# Mentor Pagination Filter Fix

## Issue
The count query used for pagination in `mentors.service.ts` was running a simplified version of the filter that only handled `search` and `expertise`, ignoring `minRate`, `maxRate`, and `isAvailable`. This caused the `total` field in the paginated response to be incorrect whenever those filters were active.

## Changes Made

### 1. Created `buildMentorFilters` Helper Method
**Location:** `src/services/mentors.service.ts` (lines 84-122)

Added a new helper method that builds filter conditions consistently:

```typescript
buildMentorFilters(
  query: Omit<ListMentorsQuery, 'cursor' | 'limit' | 'sortBy' | 'sortOrder'>,
  startIdx: number = 1,
): { conditions: string[]; values: unknown[]; nextIdx: number }
```

**Features:**
- Returns `conditions` array, `values` array, and `nextIdx` for parameterized queries
- Handles all filter parameters: `search`, `expertise`, `minRate`, `maxRate`, `isAvailable`
- Uses proper SQL parameter placeholders (`$1`, `$2`, etc.)
- Supports custom starting index for parameter numbering

### 2. Refactored `list` Method
**Location:** `src/services/mentors.service.ts` (lines 210-268)

**Before:**
- Inline filter building with inconsistent logic
- Count query only applied `search` and `expertise` filters
- Complex conditional parameter building

**After:**
- Uses `buildMentorFilters` for base filters
- Both data query and count query use the same base filters
- Cursor condition added separately only to data query
- Clean separation of concerns

**Key improvements:**
```typescript
// Build base filters (without cursor)
const baseFilters = this.buildMentorFilters(query);

// Add cursor condition for data query only
const dataConditions = [...baseFilters.conditions];
const dataValues = [...baseFilters.values];

// Count query uses same base filters
const countWhereClause = `WHERE ${baseFilters.conditions.join(' AND ')}`;
```

### 3. Added Comprehensive Tests
**Location:** `src/__tests__/services/mentors.service.unit.test.ts`

Added test suites for:

#### `buildMentorFilters` Tests:
- ✅ Build filters with all parameters
- ✅ Build filters with only search parameter
- ✅ Build filters with only rate range
- ✅ Build filters with custom start index
- ✅ Build base filters when no optional parameters provided

#### Enhanced `list` Tests:
- ✅ Apply all filters including minRate, maxRate, and isAvailable to count query
- ✅ Return correct total count when only minRate and maxRate filters are applied
- ✅ Return correct total count when only isAvailable filter is applied
- ✅ Verify total count matches actual filtered results for all filter combinations

## Testing

### Unit Tests
Run the mentor service unit tests:
```bash
npm test -- src/__tests__/services/mentors.service.unit.test.ts
```

### Manual Testing
Test the API endpoint with various filter combinations:

```bash
# Test with all filters
GET /api/mentors?search=JavaScript&expertise=React&minRate=30&maxRate=100&isAvailable=true

# Test with only rate filters
GET /api/mentors?minRate=50&maxRate=150

# Test with only availability filter
GET /api/mentors?isAvailable=true

# Test with combined filters
GET /api/mentors?search=mentor&minRate=40&maxRate=80&isAvailable=false
```

Verify that:
1. The `total` field matches the actual number of mentors that meet ALL filter criteria
2. Pagination works correctly with cursor-based navigation
3. Cache invalidation works when mentor profiles are updated

## Impact

### Fixed
- ✅ Accurate total count in paginated responses
- ✅ Consistent filter application across data and count queries
- ✅ Proper handling of all filter combinations

### Improved
- ✅ Code maintainability with shared filter logic
- ✅ Easier to add new filters in the future
- ✅ Better test coverage for filter functionality

## Files Modified
1. `src/services/mentors.service.ts` - Added helper method and refactored list method
2. `src/__tests__/services/mentors.service.unit.test.ts` - Added comprehensive tests

## Verification Checklist
- [x] Helper method created for filter building
- [x] Both data and count queries use the same filters
- [x] Tests added for all filter combinations
- [x] No syntax errors in modified files
- [ ] Unit tests pass (requires npm execution)
- [ ] Integration tests pass
- [ ] Manual API testing confirms correct behavior
