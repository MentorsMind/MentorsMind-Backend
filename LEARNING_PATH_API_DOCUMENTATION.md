# Learning Path Builder - API Documentation

## Overview

The Learning Path Builder API provides comprehensive endpoints for creating, managing, and tracking structured learning journeys on the MentorsMind platform. This API enables mentors to create learning paths, students to enroll and track progress, and both parties to leverage advanced analytics.

**Base URL**: `https://api.mentorsmind.com/api/v1`

**Authentication**: All endpoints require Bearer token authentication unless otherwise specified.

**API Version**: v1 (Stable)

---

## Table of Contents

1. [Learning Paths](#learning-paths)
2. [Progress Tracking](#progress-tracking)
3. [Session-Milestone Integration](#session-milestone-integration)
4. [Analytics](#analytics)
5. [Authentication](#authentication)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)

---

## Learning Paths

### Create Learning Path

Create a new learning path with milestones.

**Endpoint**: `POST /learning-paths`

**Authorization**: Mentor, Admin

**Request Body**:
```json
{
  "title": "Full Stack Web Development",
  "description": "Complete journey from beginner to full-stack developer",
  "estimatedDurationHours": 240,
  "difficultyLevel": "intermediate",
  "totalPrice": 1500.00,
  "pricingModel": "total",
  "currency": "XLM",
  "tags": ["web-development", "javascript", "react", "node"],
  "milestones": [
    {
      "title": "HTML & CSS Fundamentals",
      "description": "Master the basics of web structure and styling",
      "orderIndex": 1,
      "estimatedDurationHours": 40,
      "price": 250.00,
      "learningObjectives": [
        "Understand HTML5 semantic elements",
        "Master CSS layouts and flexbox",
        "Build responsive websites"
      ],
      "completionCriteria": {
        "type": "project",
        "requirements": ["Build a responsive portfolio website"]
      },
      "resources": [
        {
          "type": "video",
          "title": "HTML Crash Course",
          "url": "https://example.com/html-course"
        }
      ],
      "isRequired": true
    }
  ]
}
```

**Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "mentorId": "uuid",
    "title": "Full Stack Web Development",
    "description": "Complete journey from beginner to full-stack developer",
    "estimatedDurationHours": 240,
    "difficultyLevel": "intermediate",
    "totalPrice": 1500.00,
    "pricingModel": "total",
    "currency": "XLM",
    "isPublished": false,
    "enrolledCount": 0,
    "completionCount": 0,
    "rating": 0,
    "tags": ["web-development", "javascript", "react", "node"],
    "createdAt": "2026-05-28T10:00:00.000Z",
    "updatedAt": "2026-05-28T10:00:00.000Z"
  }
}
```

---

### Get Learning Path

Retrieve a learning path by ID with optional progress data.

**Endpoint**: `GET /learning-paths/:pathId`

**Authorization**: Public (if published), Mentor (own paths), Student (enrolled paths)

**Query Parameters**:
- `includeProgress` (boolean, optional): Include student progress data

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "mentorId": "uuid",
    "title": "Full Stack Web Development",
    "description": "Complete journey from beginner to full-stack developer",
    "estimatedDurationHours": 240,
    "difficultyLevel": "intermediate",
    "totalPrice": 1500.00,
    "isPublished": true,
    "enrolledCount": 45,
    "completionCount": 12,
    "rating": 4.7,
    "milestones": [
      {
        "id": "uuid",
        "title": "HTML & CSS Fundamentals",
        "description": "Master the basics",
        "orderIndex": 1,
        "estimatedDurationHours": 40,
        "price": 250.00,
        "learningObjectives": ["..."],
        "completionCriteria": {...},
        "resources": [...]
      }
    ],
    "enrollment": {
      "id": "uuid",
      "status": "active",
      "progress": 35.5,
      "enrolledAt": "2026-05-01T10:00:00.000Z"
    }
  }
}
```

---

### Update Learning Path

Update an existing learning path.

**Endpoint**: `PUT /learning-paths/:pathId`

**Authorization**: Mentor (owner), Admin

**Request Body**: (Partial update supported)
```json
{
  "title": "Updated Title",
  "description": "Updated description",
  "totalPrice": 1600.00
}
```

**Response**: `200 OK`

---

### Delete Learning Path

Soft delete a learning path (only if no active enrollments).

**Endpoint**: `DELETE /learning-paths/:pathId`

**Authorization**: Mentor (owner), Admin

**Response**: `204 No Content`

---

### Publish Learning Path

Publish a learning path to make it available for enrollment.

**Endpoint**: `POST /learning-paths/:pathId/publish`

**Authorization**: Mentor (owner), Admin

**Response**: `200 OK`

---

### Get Published Learning Paths

Get all published learning paths with filtering.

**Endpoint**: `GET /learning-paths`

**Authorization**: Public

**Query Parameters**:
- `difficultyLevel` (string, optional): Filter by difficulty (beginner, intermediate, advanced, expert)
- `tags` (string[], optional): Filter by tags
- `mentorId` (string, optional): Filter by mentor
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20)

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "paths": [...],
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

---

### Enroll in Learning Path

Enroll a student in a learning path.

**Endpoint**: `POST /learning-paths/:pathId/enroll`

**Authorization**: Student, Admin

**Request Body**:
```json
{
  "paymentData": {
    "transactionHash": "stellar-tx-hash",
    "amount": 1500.00,
    "currency": "XLM"
  }
}
```

**Response**: `201 Created`

---

## Progress Tracking

### Get Student Progress

Get detailed progress for a student's enrollment.

**Endpoint**: `GET /progress/enrollments/:enrollmentId`

**Authorization**: Student (own), Mentor (their students), Admin

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "enrollment": {
      "id": "uuid",
      "learningPathId": "uuid",
      "studentId": "uuid",
      "status": "active",
      "progress": 45.5,
      "enrolledAt": "2026-05-01T10:00:00.000Z"
    },
    "milestoneProgress": [
      {
        "milestoneId": "uuid",
        "status": "completed",
        "progress": 100,
        "startedAt": "2026-05-01T10:00:00.000Z",
        "completedAt": "2026-05-15T14:30:00.000Z",
        "timeSpentMinutes": 2400
      }
    ],
    "currentMilestone": {...},
    "nextMilestone": {...},
    "completedMilestones": 3,
    "totalMilestones": 8,
    "estimatedTimeRemaining": 120,
    "achievements": [...]
  }
}
```

---

### Update Progress

Update progress for a specific milestone.

**Endpoint**: `PUT /progress/enrollments/:enrollmentId/milestones/:milestoneId`

**Authorization**: Student (own), Mentor (their students), Admin

**Request Body**:
```json
{
  "progress": 75.5,
  "timeSpentMinutes": 120,
  "notes": "Completed exercises 1-5"
}
```

**Response**: `200 OK`

---

### Complete Milestone

Mark a milestone as completed.

**Endpoint**: `POST /progress/enrollments/:enrollmentId/milestones/:milestoneId/complete`

**Authorization**: Student (own), Mentor (their students), Admin

**Request Body**:
```json
{
  "completionData": {
    "projectUrl": "https://github.com/student/project",
    "notes": "Completed all requirements"
  }
}
```

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "milestoneId": "uuid",
    "enrollmentId": "uuid",
    "completedAt": "2026-05-28T10:00:00.000Z",
    "certificateGenerated": true,
    "nextMilestone": {...},
    "pathCompleted": false
  }
}
```

---

### Get Progress Summary

Get a summary of student progress.

**Endpoint**: `GET /progress/enrollments/:enrollmentId/summary`

**Authorization**: Student (own), Mentor (their students), Admin

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "totalMilestones": 8,
    "completedMilestones": 3,
    "inProgressMilestones": 1,
    "notStartedMilestones": 4,
    "overallProgress": 45.5,
    "estimatedTimeRemaining": 120,
    "currentStreak": 7,
    "lastActivity": "2026-05-28T09:30:00.000Z"
  }
}
```

---

## Session-Milestone Integration

### Map Session to Milestone

Link a booking session to a milestone.

**Endpoint**: `POST /session-milestones`

**Authorization**: Mentor, Admin

**Request Body**:
```json
{
  "milestoneId": "uuid",
  "bookingId": "uuid",
  "sessionType": "milestone",
  "contributesToCompletion": true,
  "completionWeight": 1.0
}
```

**Response**: `201 Created`

---

### Get Session Context

Get learning path context for a session.

**Endpoint**: `GET /session-milestones/sessions/:bookingId/context`

**Authorization**: Mentor, Student (participants), Admin

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "learningPath": {...},
    "currentMilestone": {...},
    "studentProgress": {...},
    "previousSessions": [...],
    "recommendedTopics": [...]
  }
}
```

---

### Record Session Outcome

Record the outcome of a session.

**Endpoint**: `POST /session-milestones/sessions/:bookingId/outcome`

**Authorization**: Mentor, Admin

**Request Body**:
```json
{
  "milestoneId": "uuid",
  "progressMade": 25.0,
  "sessionEffectiveness": 0.85,
  "topicsCovered": ["React Hooks", "State Management"],
  "studentPerformance": "good",
  "notes": "Student grasped concepts quickly",
  "nextSteps": ["Practice with real project", "Review async patterns"]
}
```

**Response**: `201 Created`

---

## Analytics

### Get Path Analytics

Get comprehensive analytics for a learning path.

**Endpoint**: `GET /analytics/paths/:pathId`

**Authorization**: Mentor (owner), Admin

**Query Parameters**:
- `timeframe` (string, optional): week, month, quarter, year, all (default: all)

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "pathId": "uuid",
    "pathTitle": "Full Stack Web Development",
    "totalEnrollments": 150,
    "activeStudents": 95,
    "completedStudents": 45,
    "averageCompletionTime": 180.5,
    "completionRate": 30.0,
    "dropoutRate": 15.0,
    "averageProgress": 62.3,
    "revenueGenerated": 67500.00,
    "studentSatisfaction": 4.7,
    "milestoneAnalytics": [...],
    "trendData": {...},
    "bottlenecks": [...]
  }
}
```

---

### Get Student Learning Profile

Get behavioral analytics and learning profile for a student.

**Endpoint**: `GET /analytics/students/:studentId/profile`

**Authorization**: Student (own), Mentor (their students), Admin

**Query Parameters**:
- `pathId` (string, optional): Filter by specific learning path

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "studentId": "uuid",
    "studentName": "John Doe",
    "learningStyle": "visual",
    "learningVelocity": 1.5,
    "averageSessionEffectiveness": 0.85,
    "preferredSessionTypes": ["milestone", "support"],
    "strongAreas": ["Problem solving", "Consistent practice"],
    "improvementAreas": ["Time management"],
    "engagementScore": 78.5,
    "consistencyScore": 65.0,
    "collaborationScore": 45.0,
    "predictedSuccessRate": 82.3,
    "recommendations": [...]
  }
}
```

---

### Get Predictive Insights

Get AI-powered predictions for student success.

**Endpoint**: `GET /analytics/students/:studentId/paths/:pathId/insights`

**Authorization**: Student (own), Mentor (their students), Admin

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "studentId": "uuid",
    "pathId": "uuid",
    "predictedCompletionDate": "2026-08-15T00:00:00.000Z",
    "successProbability": 82.3,
    "riskFactors": [
      {
        "factor": "Inconsistent Activity",
        "severity": "medium",
        "description": "Irregular study patterns detected",
        "mitigation": "Help student establish regular study routine"
      }
    ],
    "interventionRecommendations": [...],
    "optimalNextSteps": [...]
  }
}
```

---

### Get Comparison Analytics

Compare student performance with peers.

**Endpoint**: `GET /analytics/students/:studentId/paths/:pathId/comparison`

**Authorization**: Student (own), Mentor (their students), Admin

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "studentId": "uuid",
    "pathId": "uuid",
    "studentMetrics": {
      "completionRate": 75.0,
      "averageProgress": 65.5,
      "learningVelocity": 1.5,
      "sessionEffectiveness": 0.85,
      "engagementScore": 78.5,
      "timeSpent": 14400
    },
    "peerAverages": {
      "completionRate": 60.0,
      "averageProgress": 55.0,
      "learningVelocity": 1.2,
      "sessionEffectiveness": 0.75,
      "engagementScore": 65.0,
      "timeSpent": 12000
    },
    "percentile": 75.5,
    "strengths": ["Completion rate above average", "Learning pace faster than peers"],
    "areasForImprovement": []
  }
}
```

---

### Get Mentor Dashboard

Get comprehensive analytics dashboard for mentors.

**Endpoint**: `GET /analytics/mentors/:mentorId/dashboard`

**Authorization**: Mentor (own), Admin

**Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "mentorId": "uuid",
    "summary": {
      "totalPaths": 5,
      "totalEnrollments": 150,
      "totalCompletions": 45,
      "activeStudents": 95,
      "averageRating": 4.7,
      "completionRate": 30.0
    },
    "topPaths": [...],
    "studentsNeedingAttention": [...],
    "recentActivity": [...]
  }
}
```

---

## Authentication

All API endpoints require authentication using Bearer tokens.

**Header**:
```
Authorization: Bearer <your-jwt-token>
```

**Getting a Token**:
```
POST /auth/login
{
  "email": "user@example.com",
  "password": "password"
}
```

---

## Error Handling

All errors follow a consistent format:

**Error Response**:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "title",
        "message": "Title is required"
      }
    ]
  }
}
```

**HTTP Status Codes**:
- `200 OK`: Successful request
- `201 Created`: Resource created successfully
- `204 No Content`: Successful deletion
- `400 Bad Request`: Invalid input
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `409 Conflict`: Resource conflict
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

---

## Rate Limiting

API requests are rate-limited to ensure fair usage:

- **General**: 100 requests per minute per user
- **Analytics**: 20 requests per minute per user
- **Bulk Operations**: 10 requests per minute per user

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1622548800
```

---

## Pagination

List endpoints support pagination:

**Query Parameters**:
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20, max: 100)

**Response**:
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

## Webhooks

Subscribe to real-time events:

**Available Events**:
- `enrollment.created`
- `enrollment.completed`
- `milestone.completed`
- `progress.updated`
- `certificate.issued`

**Webhook Payload**:
```json
{
  "event": "milestone.completed",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "data": {
    "enrollmentId": "uuid",
    "milestoneId": "uuid",
    "studentId": "uuid",
    "pathId": "uuid"
  }
}
```

---

## SDKs and Client Libraries

Official SDKs available for:
- JavaScript/TypeScript
- Python
- Ruby
- PHP
- Go

**Example (JavaScript)**:
```javascript
import { MentorsMindClient } from '@mentorsmind/sdk';

const client = new MentorsMindClient({
  apiKey: 'your-api-key'
});

const path = await client.learningPaths.create({
  title: 'My Learning Path',
  // ...
});
```

---

## Support

- **Documentation**: https://docs.mentorsmind.com
- **API Status**: https://status.mentorsmind.com
- **Support Email**: api-support@mentorsmind.com
- **Developer Forum**: https://forum.mentorsmind.com

---

**Last Updated**: May 28, 2026
**API Version**: v1.0.0
