# Advanced NLP Search - Quick Start

## 5-Minute Integration

### 1. Mount Routes

```typescript
// src/server.ts or app.ts
import advancedNlpSearchRoutes from './routes/advanced-nlp-search.routes';

app.use('/api/v1/search', advancedNlpSearchRoutes);
```

### 2. Test Query Parsing

```bash
# See what the system understands
curl "http://localhost:5000/api/v1/search/parse?query=python%20tutor%20under%2050%20dollars%20weekends"
```

### 3. Test Full Search

```bash
curl -X POST http://localhost:5000/api/v1/search/mentors/nlp \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "affordable Python tutor for beginners on weekends"}'
```

## Common Queries & Results

### Query 1: Comprehensive
```
Input: "Python ML expert, $30-60/hr, available mornings on weekends, 5+ years experience"
Parsed Skills: ["Python", "Machine Learning"]
Parsed Filters: minRate: 30, maxRate: 60, availableDays: ["Saturday", "Sunday"], yearsOfExperience: 5+
Confidence: 0.95 (HIGH)
```

### Query 2: Vague
```
Input: "teach me stuff"
Parsed Skills: []
Parsed Filters: (none)
Confidence: 0.2 (LOW)
Suggestion: More specific query needed
```

### Query 3: Mixed Natural Language
```
Input: "JavaScript tutor who is patient with hands-on approach, flexible schedule $75"
Parsed Skills: ["JavaScript"]
Parsed Filters: maxRate: 75, teachingStyle: ["hands-on"], availability: flexible
Confidence: 0.8 (HIGH)
```

## Frontend Integration

### React Example

```jsx
import { useState } from 'react';

function MentorSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [explanation, setExplanation] = useState('');

  const handleSearch = async (e) => {
    if (e.key !== 'Enter') return;

    const response = await fetch('/api/v1/search/mentors/nlp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    setResults(data.data.mentors);
    setExplanation(data.data.explanation);
  };

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyPress={handleSearch}
        placeholder="Try: 'Python tutor under $50 on weekends'"
      />
      {explanation && <p style={{ color: 'gray' }}>{explanation}</p>}
      {results.map(mentor => (
        <div key={mentor.id}>
          <h3>{mentor.first_name}</h3>
          <p>${mentor.hourly_rate}/hr • {mentor.average_rating} stars</p>
        </div>
      ))}
    </div>
  );
}
```

## Query Examples

### Skills Queries
```
"Python tutor"
"JavaScript expert"
"machine learning specialist"
"data science coach"
```

### Price Queries
```
"under $50"
"$30 to $60 per hour"
"affordable"
"budget friendly"
```

### Availability Queries
```
"weekends only"
"available mornings"
"flexible schedule"
"evenings and weekends"
```

### Experience Queries
```
"beginner level"
"for advanced students"
"10+ years experience"
"expert programmer"
```

### Combined Queries
```
"Python tutor for beginners under $50 on weekends"
"JavaScript expert, $60+/hr, flexible, high-rated"
"affordable ML coach for absolute beginners"
```

## Debugging

### Check What System Understood

```bash
# Parse endpoint shows raw intent extraction
curl "http://localhost:5000/api/v1/search/parse?query=YOUR_QUERY"

# Response shows:
# - skills extracted
# - price filters
# - availability
# - confidence score
# - human-readable explanation
```

### Explain Query

```bash
curl -X POST http://localhost:5000/api/v1/search/explain \
  -d '{"query": "YOUR_QUERY"}' | jq '.data.explanation'

# Shows detailed breakdown of what each part means
```

## Common Issues

### Q: Why wasn't skill recognized?

**A:** Check if skill is in the synonym list. Add to SKILL_SYNONYMS if missing.

### Q: Query confidence is low

**A:** Add more specifics to query:
- Include price range
- Mention availability
- Specify experience level
- Add skill names clearly

### Q: Getting wrong results

**A:** Use `/search/parse` to debug what was extracted, then adjust query or add to synonyms

## Next Steps

1. **Integrate into search UI** - Replace current search with NLP version
2. **Add search analytics** - Track common queries and success rates
3. **Extend synonyms** - Add domain-specific skills and terms
4. **Improve confidence** - Adjust weights based on user feedback
5. **Add corrections** - Suggest alternative queries for low-confidence cases

## API Reference

### POST /api/v1/search/mentors/nlp

Search mentors with NLP

**Request:**
```json
{
  "query": "Python tutor for beginners under $50/hour",
  "limit": 20,
  "offset": 0
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "mentors": [...],
    "intent": {...},
    "totalCount": 5,
    "searchQuality": "high",
    "explanation": "..."
  }
}
```

### GET /api/v1/search/parse

Debug query parsing

**Query Params:** `query=<natural_language_query>`

**Response:** Shows parsed intent with confidence score

### GET /api/v1/search/suggestions

Get autocomplete suggestions

**Query Params:** `q=<partial_query>`

**Response:** List of suggested skills, mentors, topics

### POST /api/v1/search/explain

Get detailed explanation of query parsing

**Request:** `{"query": "..."}`

**Response:** Detailed breakdown of extraction with reasoning
