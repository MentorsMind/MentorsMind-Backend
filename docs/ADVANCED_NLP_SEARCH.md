# Advanced NLP Mentor Search System

## Overview

Transforms natural language queries into structured mentor search filters with automatic intent extraction, enabling non-technical users to find mentors effectively without learning complex search syntax.

## Problem Solved

**Before:**
```
User: "I need a Python tutor for machine learning who charges under $50 per hour and is available on weekends"
Result: Mentors with "python" in bio, ignores price ($50), experience level, and availability
```

**After:**
```
User: "I need a Python tutor for machine learning who charges under $50 per hour and is available on weekends"
Parsed: {
  skills: ["Python", "Machine Learning"],
  maxRate: 50,
  availableDays: ["Saturday", "Sunday"],
  confidence: 0.95
}
Result: Mentors matching ALL criteria, ranked by relevance
```

## Architecture

### Three-Layer Processing

1. **Query Parsing** - Extract structured intent from natural language
2. **Filter Building** - Convert intent into SQL where clauses
3. **Ranking** - Score and sort mentors by relevance

### Extraction Methods

| Parameter | Detection | Examples |
|-----------|-----------|----------|
| **Skills** | Regex matching + synonym expansion | "Python", "machine learning", "ML", "deep learning" |
| **Price** | Amount extraction | "under $50", "$30-60/hour", "at least $40" |
| **Availability** | Day/time parsing | "weekends", "Monday-Friday", "evenings" |
| **Experience** | Keyword matching | "beginner", "intermediate", "advanced", "expert" |
| **Rating** | Number extraction | "4.5 stars", "rated 5+", "highly rated" |
| **Teaching Style** | Style keywords | "hands-on", "practical", "structured", "interactive" |
| **Location** | Geographic parsing | "in New York", "based in Austin" |

## Core Components

### Service: `AdvancedNlpSearchService`

**Main Functions:**

1. `parseQuery(rawQuery)` - Extract structured intent
2. `buildMentorQuery(intent)` - Create SQL from intent
3. `searchMentors(rawQuery)` - End-to-end search
4. `getSuggestions(partialQuery)` - Autocomplete suggestions

### Controller: `AdvancedNlpSearchController`

**Endpoints:**

1. `POST /api/v1/search/mentors/nlp` - Search with NLP
2. `GET /api/v1/search/parse` - Debug: show parsed intent
3. `GET /api/v1/search/suggestions` - Autocomplete suggestions
4. `POST /api/v1/search/explain` - Explain search understanding

## Usage Examples

### Example 1: Complete Query Parsing

```bash
curl -X POST http://localhost:5000/api/v1/search/mentors/nlp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "I need a Python tutor for machine learning who charges under $50/hour and is available on weekends"
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "mentors": [
      {
        "id": "mentor_123",
        "first_name": "Jane",
        "hourly_rate": 45,
        "expertise": ["Python", "Machine Learning"],
        "average_rating": 4.8,
        "availability_schedule": { "Saturday": ["10:00-14:00"], "Sunday": ["14:00-18:00"] }
      }
    ],
    "intent": {
      "skills": ["Python", "Machine Learning"],
      "maxRate": 50,
      "availableDays": ["Saturday", "Sunday"],
      "confidence": 0.95,
      "experienceLevel": undefined
    },
    "totalCount": 3,
    "searchQuality": "high",
    "explanation": "Found mentors matching: skills: Python, Machine Learning • hourly rate: under $50 • available: Saturday, Sunday"
  }
}
```

### Example 2: Debug Query Parsing

```bash
curl "http://localhost:5000/api/v1/search/parse?query=affordable%20Python%20coach%20for%20beginners"
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "intent": {
      "skills": ["Python"],
      "maxRate": undefined,
      "experienceLevel": "beginner",
      "teachingStyle": ["hands-on"],
      "confidence": 0.72
    },
    "explanation": "Found mentors matching: skills: Python • experience level: beginner",
    "confidenceLevel": "high"
  }
}
```

### Example 3: Explain Search

```bash
curl -X POST http://localhost:5000/api/v1/search/explain \
  -d '{"query": "experienced javascript tutor with 5+ years, flexible schedule, $60/hour"}'
```

**Response shows:**
- What was extracted (skills, experience, rate, etc.)
- Explanation of each filter
- Confidence score and interpretation
- Why system understood/misunderstood the query

## Supported Queries

### Skills Extraction

**Python variants:** "python", "py", "django", "flask", "fastapi", "pandas", "numpy"
**JavaScript variants:** "js", "javascript", "typescript", "react", "node"
**ML variants:** "ml", "machine learning", "deep learning", "neural network", "tensorflow"

### Price Parsing

```
"under $50"               → maxRate: 50
"$30 to $60 per hour"     → minRate: 30, maxRate: 60
"at least $40/hour"       → minRate: 40
"starting at $35"         → minRate: 35
```

### Availability Parsing

```
"weekends"                → Saturday, Sunday
"Monday to Friday"        → Monday through Friday
"evenings and weekends"   → Evening times + Saturday, Sunday
"flexible schedule"       → Flexible flag (any time)
"9am to 5pm"             → Time range specified
```

### Experience Levels

```
"beginner"                → experienceLevel: "beginner"
"starter material"        → experienceLevel: "beginner"
"advanced topics"         → experienceLevel: "advanced"
"professional/expert"     → experienceLevel: "advanced"
```

### Teaching Styles

```
"hands-on"               → handson style
"project-based"          → hands-on
"practical"              → hands-on
"step-by-step"          → structured
"flexible pace"          → flexible
"interactive discussion" → interactive
```

## Intent Confidence Scoring

Confidence ranges from 0.1 to 1.0 based on:

- Number of parameters extracted (+0.15 each for skills, price, availability, experience, rating)
- Query length (minimum -0.1 for very short queries)
- Clarity of intent indicators

**Interpretation:**
- **>0.7**: HIGH - System very confident in understanding
- **0.4-0.7**: MEDIUM - Partial understanding, some ambiguity
- **<0.4**: LOW - Unclear query, recommend clarification

## SQL Query Building

The service converts parsed intent to optimized SQL:

```sql
SELECT m.* FROM mentors m
WHERE m.is_active = true
  AND m.kyc_verified = true
  AND m.hourly_rate <= 50                                    -- maxRate filter
  AND m.expertise @> '["Python", "Machine Learning"]'::jsonb  -- skill filter
  AND m.average_rating >= 4.0                                -- rating filter
  AND m.years_of_experience >= 3                             -- experience filter
  AND (m.availability_schedule->'Saturday' IS NOT NULL      -- availability filter
       OR m.availability_schedule->'Sunday' IS NOT NULL)
ORDER BY m.quality_tier, RELEVANCE DESC, m.average_rating DESC
LIMIT 50
```

## Integration

### 1. Mount Routes

```typescript
import advancedNlpSearchRoutes from './routes/advanced-nlp-search.routes';

app.use('/api/v1/search', advancedNlpSearchRoutes);
```

### 2. Use in Frontend

```typescript
// Search mentors with natural language
const results = await api.post('/search/mentors/nlp', {
  query: "Python tutor for beginners under $50/hour on weekends"
});

// Show what was understood
const { intent, explanation, mentors } = results.data;
console.log(explanation); // "Found mentors matching: skills: Python • experience level: beginner • hourly rate: under $50 • available: Saturday, Sunday"
```

### 3. Debug in Tests

```typescript
// See what the system extracts from a query
const parsed = await api.get('/search/parse?query=...');
console.log(parsed.data.intent);
console.log(parsed.data.explanation);
```

## Performance

- **Query Parsing**: <10ms (regex-based extraction)
- **Database Search**: <100ms (indexed queries)
- **Suggestions**: <50ms (cached data)
- **Total Response Time**: <200ms typical

## Customization

### Add New Skills

Edit `SKILL_SYNONYMS` in `AdvancedNlpSearchService`:

```typescript
const SKILL_SYNONYMS: Record<string, string[]> = {
  "rust": ["rust", "actix"],
  "golang": ["go", "golang"],
  // Add more...
};
```

### Add New Teaching Styles

```typescript
const TEACHING_STYLES = {
  "mentoring": ["mentoring", "guidance", "advice"],
  // Add more...
};
```

### Adjust Confidence Weights

Modify `calculateConfidence()` function:

```typescript
if (intent.skills.length > 0) score += 0.20;  // Increase weight for skills
```

## Limitations & Future Enhancements

### Current Limitations

- Single language (English)
- Basic keyword matching (not AI/ML-based)
- Fixed synonym dictionary
- No context learning from user behavior

### Planned Enhancements

- Multi-language support
- Vector embeddings for semantic similarity
- User behavior learning (what queries led to bookings)
- Spelling correction and typo tolerance
- Intent ambiguity detection and clarification

## Monitoring

Track search effectiveness:

```sql
-- Most common search intents
SELECT 
  skills,
  COUNT(*) as count,
  AVG(results_count) as avg_results,
  AVG(confidence) as avg_confidence
FROM search_logs
GROUP BY skills
ORDER BY count DESC;
```

## Troubleshooting

### Low Confidence Score

**Cause**: Query is ambiguous or lacks specific details
**Solution**: Suggest user add more specifics (e.g., price range, availability)

### Skill Not Recognized

**Cause**: Skill not in synonym dictionary or typo in query
**Solution**: Add variant to SKILL_SYNONYMS or suggest correction

### Wrong Experience Level Detected

**Cause**: Keyword collision (e.g., "expert" in bio)
**Solution**: Add context-aware parsing

## References

- [Advanced NLP Search Service](../src/services/advanced-nlp-search.service.ts)
- [Controller Implementation](../src/controllers/advanced-nlp-search.controller.ts)
- [Routes Setup](../src/routes/advanced-nlp-search.routes.ts)
