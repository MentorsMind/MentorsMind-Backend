# Elasticsearch Advanced Search Implementation

## Overview
This document describes the implementation of Elasticsearch-based advanced search for the MentorMinds backend, replacing basic PostgreSQL LIKE queries with powerful full-text search capabilities.

## Features Implemented

### 1. Elasticsearch Service (`src/services/elasticsearch.service.ts`)
- **Client Management**: Automatic connection handling with authentication support (username/password or API key)
- **Index Management**: Create, delete, and manage Elasticsearch indices
- **Document Operations**: Index, bulk index, and delete documents
- **Advanced Search**: Full-text search with fuzzy matching, multi-field queries, and relevance scoring
- **Autocomplete**: Type-ahead suggestions using completion suggesters
- **Similar Mentors**: "More like this" queries for finding similar mentors based on expertise and bio
- **Search Analytics**: Track search queries and results for analytics
- **Popular Searches**: Aggregate and retrieve most common search queries

### 2. Elasticsearch Index Service (`src/services/elasticsearch-index.service.ts`)
- **Index Initialization**: Set up indices with proper mappings and analyzers
- **Data Sync**: Bulk sync mentors, sessions, and content from PostgreSQL to Elasticsearch
- **Real-time Updates**: Index individual mentors/sessions on create/update/delete
- **Fallback Handling**: Graceful handling of missing tables or data

### 3. Enhanced Search Service (`src/services/search.service.ts`)
- **Hybrid Approach**: Uses Elasticsearch when available, falls back to PostgreSQL
- **Automatic Fallback**: Seamless degradation if Elasticsearch is unavailable
- **Feature Parity**: All existing search functionality preserved
- **New Features**: Autocomplete, similar mentors, and popular searches

### 4. Updated Controllers (`src/controllers/search.controller.ts`)
- **Enhanced Mentor Search**: Support for relevance-based sorting and aggregations
- **Autocomplete Endpoint**: `/api/v1/search/autocomplete/:query`
- **Similar Mentors Endpoint**: `/api/v1/search/similar/:mentorId`
- **Popular Searches Endpoint**: `/api/v1/search/popular`

### 5. Configuration
- **Environment Variables**: Added Elasticsearch configuration to `.env.example`
- **Config Module**: Centralized Elasticsearch configuration in `src/config/elasticsearch.config.ts`
- **Security**: Sensitive keys (password, API key) marked as sensitive in env validation

## Search Capabilities

### Full-Text Search
- Multi-field search across name, bio, and expertise
- Fuzzy matching with configurable distance (default: 2)
- Phrase prefix matching for autocomplete
- Relevance scoring with field boosting (name^3, bio^2)

### Faceted Search
- Skills filter
- Price range filter
- Rating filter
- Language filter
- Availability filter
- Aggregations for faceted navigation

### Sorting Options
- Relevance (default)
- Rating (highest first)
- Price (lowest first)
- Newest (most recent first)

### Advanced Features
- **Autocomplete**: Real-time suggestions as user types
- **Similar Mentors**: Find mentors with similar expertise
- **Search Analytics**: Track search patterns for insights
- **Popular Searches**: Display trending search queries

## Index Mappings

### Mentors Index
```json
{
  "properties": {
    "id": { "type": "keyword" },
    "name": {
      "type": "text",
      "fields": {
        "keyword": { "type": "keyword" },
        "suggest": { "type": "completion", "analyzer": "simple" }
      },
      "analyzer": "text_analyzer"
    },
    "email": { "type": "keyword" },
    "expertise": { "type": "keyword" },
    "hourly_rate": { "type": "float" },
    "average_rating": { "type": "float" },
    "bio": { "type": "text", "analyzer": "text_analyzer" },
    "languages": { "type": "keyword" },
    "availability": { "type": "keyword" },
    "created_at": { "type": "date" },
    "verified": { "type": "boolean" }
  }
}
```

### Sessions Index
Similar structure with session-specific fields.

### Content Index
Similar structure with content-specific fields.

## Text Analysis

### Custom Analyzers
- **text_analyzer**: Standard tokenizer + lowercase + stop words + snowball stemming
- **autocomplete_analyzer**: Standard tokenizer + lowercase + n-gram filter

### N-gram Filter
- Min gram: 2
- Max gram: 20
- Enables partial matching for autocomplete

## Setup Instructions

### 1. Install Dependencies
```bash
npm install @elastic/elasticsearch
```

### 2. Configure Environment Variables
Add to `.env`:
```env
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=
ELASTICSEARCH_API_KEY=
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_INDEX_PREFIX=mentorminds
```

### 3. Start Elasticsearch
Using Docker:
```bash
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  -p 9300:9300 \
  -e "discovery.type=single-node" \
  -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0
```

### 4. Initialize Indices
Run the sync script (create one in scripts/):
```bash
npm run sync:elasticsearch
```

Or call programmatically:
```typescript
import elasticsearchIndexService from './services/elasticsearch-index.service';
await elasticsearchIndexService.syncAll();
```

### 5. Update Data on Changes
When mentors or sessions are created/updated/deleted:
```typescript
import elasticsearchIndexService from './services/elasticsearch-index.service';

// On mentor create/update
await elasticsearchIndexService.indexMentor(mentorId);

// On mentor delete
await elasticsearchIndexService.deleteMentor(mentorId);

// On session create/update
await elasticsearchIndexService.indexSession(sessionId);

// On session delete
await elasticsearchIndexService.deleteSession(sessionId);
```

## API Endpoints

### Search Mentors
```
GET /api/v1/search/mentors
```

Query Parameters:
- `query`: Search query string
- `skills`: Comma-separated skill filters
- `minPrice`: Minimum hourly rate
- `maxPrice`: Maximum hourly rate
- `minRating`: Minimum rating
- `language`: Language filter
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 10, max: 100)
- `sort`: Sort option - relevance|rating|price|newest (default: relevance)

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "mentor-123",
      "name": "John Doe",
      "expertise": ["javascript", "react"],
      "hourly_rate": 75,
      "average_rating": 4.8,
      "score": 12.5
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 10,
    "aggregations": {
      "skills": { "buckets": [...] },
      "price_ranges": { "buckets": [...] },
      "rating_ranges": { "buckets": [...] }
    }
  }
}
```

### Autocomplete
```
GET /api/v1/search/autocomplete/:query
```

Query Parameters:
- `limit`: Number of suggestions (default: 10)

Response:
```json
{
  "success": true,
  "data": ["John Doe", "Jane Smith", "Bob Johnson"]
}
```

### Similar Mentors
```
GET /api/v1/search/similar/:mentorId
```

Query Parameters:
- `limit`: Number of similar mentors (default: 5)

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "mentor-456",
      "name": "Jane Smith",
      "expertise": ["javascript", "react", "nodejs"]
    }
  ]
}
```

### Popular Searches
```
GET /api/v1/search/popular
```

Query Parameters:
- `limit`: Number of popular searches (default: 10)

Response:
```json
{
  "success": true,
  "data": [
    { "query": "javascript", "count": 100 },
    { "query": "react", "count": 80 }
  ]
}
```

## Performance Benefits

### Before (PostgreSQL LIKE)
- Full table scans on large datasets
- No relevance ranking
- Limited filtering capabilities
- Slow on complex queries

### After (Elasticsearch)
- Inverted index for fast full-text search
- Relevance scoring with field boosting
- Complex aggregations and faceting
- Sub-second response times
- Horizontal scaling capability

## Monitoring and Maintenance

### Health Checks
```typescript
import elasticsearchService from './services/elasticsearch.service';
const isHealthy = await elasticsearchService.checkConnection();
```

### Reindexing
```typescript
import elasticsearchIndexService from './services/elasticsearch-index.service';
await elasticsearchIndexService.syncAll();
```

### Index Statistics
Use Elasticsearch APIs to monitor:
- Document count
- Index size
- Search performance
- Query latency

## Testing

Unit tests are provided for:
- Elasticsearch service connection and operations
- Search service with Elasticsearch integration
- Fallback behavior when Elasticsearch is unavailable

Run tests:
```bash
npm test -- elasticsearch.service.test.ts
npm test -- search.service.test.ts
```

## Troubleshooting

### Elasticsearch Connection Failed
- Check ELASTICSEARCH_URL is correct
- Verify Elasticsearch is running
- Check authentication credentials
- Review firewall/network settings

### Search Results Empty
- Verify indices are created and populated
- Check document mappings
- Review search query syntax
- Enable debug logging

### Performance Issues
- Check index size and document count
- Review query complexity
- Consider adding more Elasticsearch nodes
- Optimize mappings and analyzers

## Future Enhancements

1. **Synonyms**: Add synonym filter for better matching
2. **Geo Search**: Add location-based search for mentors
3. **Personalization**: Use search history for personalized results
4. **A/B Testing**: Test different ranking algorithms
5. **Query Suggestions**: Provide query suggestions based on analytics
6. **Multi-language**: Support for internationalized search
7. **Index Aliases**: Use aliases for zero-downtime reindexing
8. **Search-as-you-type**: Implement real-time search updates

## Security Considerations

- Elasticsearch credentials stored in environment variables
- Sensitive keys marked in env validation
- No direct Elasticsearch exposure to clients
- Rate limiting on search endpoints
- Input validation on all search parameters

## Deployment

### Docker Compose
Add to `docker-compose.yml`:
```yaml
elasticsearch:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
  environment:
    - discovery.type=single-node
    - ES_JAVA_OPTS=-Xms512m -Xmx512m
  ports:
    - "9200:9200"
    - "9300:9300"
  volumes:
    - elasticsearch_data:/usr/share/elasticsearch/data

volumes:
  elasticsearch_data:
```

### Production Considerations
- Use Elasticsearch cluster for high availability
- Enable security features (TLS, authentication)
- Configure proper resource limits
- Set up monitoring and alerting
- Implement backup strategy
- Use index lifecycle management
