# Learning Path Builder - Quick Start Guide

## 🚀 Quick Start for Developers

This guide provides a quick overview of the Learning Path Builder implementation for developers joining the project.

---

## 📁 Project Structure

```
src/
├── models/
│   ├── learning-path.model.ts      # Learning path data models
│   ├── milestone.model.ts          # Milestone models
│   └── enrollment.model.ts         # Enrollment & progress models
│
├── services/
│   ├── learning-path.service.ts    # Path CRUD operations
│   ├── progress-tracking.service.ts # Progress management
│   ├── enrollment.service.ts       # Enrollment handling
│   ├── milestone-completion.service.ts # Milestone completion
│   ├── student-dashboard.service.ts # Student dashboard
│   ├── session-milestone.service.ts # Session mapping
│   ├── contextual-booking.service.ts # Smart booking
│   ├── session-outcome.service.ts  # Outcome tracking
│   ├── booking-compatibility.service.ts # Backward compatibility
│   ├── prerequisite-validator.service.ts # Prerequisites
│   ├── path-template.service.ts    # Templates
│   ├── certificate-generator.service.ts # Certificates
│   ├── collaborative-learning.service.ts # Collaboration
│   ├── learning-analytics.service.ts # Analytics
│   └── webhook.service.ts          # Webhooks
│
├── controllers/
│   ├── learning-path.controller.ts # Path endpoints
│   ├── progress.controller.ts      # Progress endpoints
│   ├── session-milestone.controller.ts # Session endpoints
│   └── analytics.controller.ts     # Analytics endpoints
│
└── routes/
    ├── learning-path.routes.ts     # Path routes
    ├── progress.routes.ts          # Progress routes
    ├── session-milestone.routes.ts # Session routes
    └── analytics.routes.ts         # Analytics routes

database/migrations/
├── 021_learning_paths.sql          # Main schema (21 tables)
└── 022_webhooks.sql                # Webhook schema (2 tables)
```

---

## 🔑 Key Concepts

### 1. Learning Path
A structured learning journey with multiple milestones.

```typescript
interface LearningPath {
  id: string;
  mentorId: string;
  title: string;
  description: string;
  estimatedDurationHours: number;
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  totalPrice: number;
  pricingModel: 'total' | 'milestone' | 'subscription';
  isPublished: boolean;
  milestones: Milestone[];
}
```

### 2. Milestone
A checkpoint within a learning path.

```typescript
interface Milestone {
  id: string;
  learningPathId: string;
  title: string;
  orderIndex: number;
  estimatedDurationHours: number;
  learningObjectives: string[];
  completionCriteria: object;
  resources: Resource[];
  isRequired: boolean;
}
```

### 3. Enrollment
A student's enrollment in a learning path.

```typescript
interface Enrollment {
  id: string;
  learningPathId: string;
  studentId: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  progress: number;
  currentMilestoneId: string;
  enrolledAt: Date;
}
```

### 4. Progress
Tracking student progress through milestones.

```typescript
interface MilestoneProgress {
  id: string;
  enrollmentId: string;
  milestoneId: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  progress: number;
  timeSpentMinutes: number;
  startedAt?: Date;
  completedAt?: Date;
}
```

---

## 🛠️ Common Operations

### Create a Learning Path

```typescript
import { LearningPathService } from './services/learning-path.service';

const path = await LearningPathService.createPath(mentorId, {
  title: 'Full Stack Web Development',
  description: 'Complete journey from beginner to full-stack developer',
  estimatedDurationHours: 240,
  difficultyLevel: 'intermediate',
  totalPrice: 1500.00,
  pricingModel: 'total',
  currency: 'XLM',
  tags: ['web-development', 'javascript'],
  milestones: [
    {
      title: 'HTML & CSS Fundamentals',
      description: 'Master the basics',
      orderIndex: 1,
      estimatedDurationHours: 40,
      price: 250.00,
      learningObjectives: ['Understand HTML5', 'Master CSS'],
      completionCriteria: { type: 'project' },
      resources: [],
      isRequired: true
    }
  ]
});
```

### Enroll a Student

```typescript
import { LearningPathService } from './services/learning-path.service';

const enrollment = await LearningPathService.enrollStudent(
  pathId,
  studentId,
  { transactionHash: 'stellar-tx-hash', amount: 1500.00 }
);
```

### Update Progress

```typescript
import { ProgressTrackingService } from './services/progress-tracking.service';

await ProgressTrackingService.updateProgress(
  enrollmentId,
  milestoneId,
  75.5, // progress percentage
  120   // time spent in minutes
);
```

### Complete a Milestone

```typescript
import { ProgressTrackingService } from './services/progress-tracking.service';

const result = await ProgressTrackingService.completeMilestone(
  enrollmentId,
  milestoneId,
  {
    completionData: {
      projectUrl: 'https://github.com/student/project',
      notes: 'Completed all requirements'
    }
  }
);

console.log(result.pathCompleted); // true if all milestones done
console.log(result.nextMilestone); // next milestone to work on
```

### Get Analytics

```typescript
import { LearningAnalyticsService } from './services/learning-analytics.service';

// Path analytics
const pathAnalytics = await LearningAnalyticsService.getPathAnalytics(
  pathId,
  'month' // timeframe
);

// Student profile
const profile = await LearningAnalyticsService.getStudentLearningProfile(
  studentId,
  pathId
);

// Predictive insights
const insights = await LearningAnalyticsService.getPredictiveInsights(
  studentId,
  pathId
);
```

### Trigger Webhooks

```typescript
import { WebhookService } from './services/webhook.service';

// Trigger an event
await WebhookService.triggerEvent(
  WebhookService.EVENTS.MILESTONE_COMPLETED,
  {
    enrollmentId: 'uuid',
    milestoneId: 'uuid',
    studentId: 'uuid',
    pathId: 'uuid'
  }
);
```

---

## 🔌 API Endpoints

### Learning Paths

```bash
# Create learning path
POST /api/v1/learning-paths

# Get learning path
GET /api/v1/learning-paths/:pathId

# Update learning path
PUT /api/v1/learning-paths/:pathId

# Delete learning path
DELETE /api/v1/learning-paths/:pathId

# Publish learning path
POST /api/v1/learning-paths/:pathId/publish

# List published paths
GET /api/v1/learning-paths

# Enroll student
POST /api/v1/learning-paths/:pathId/enroll
```

### Progress Tracking

```bash
# Get student progress
GET /api/v1/progress/enrollments/:enrollmentId

# Update progress
PUT /api/v1/progress/enrollments/:enrollmentId/milestones/:milestoneId

# Complete milestone
POST /api/v1/progress/enrollments/:enrollmentId/milestones/:milestoneId/complete

# Get progress summary
GET /api/v1/progress/enrollments/:enrollmentId/summary
```

### Analytics

```bash
# Path analytics
GET /api/v1/analytics/paths/:pathId?timeframe=month

# Student profile
GET /api/v1/analytics/students/:studentId/profile?pathId=uuid

# Predictive insights
GET /api/v1/analytics/students/:studentId/paths/:pathId/insights

# Comparison analytics
GET /api/v1/analytics/students/:studentId/paths/:pathId/comparison

# Mentor dashboard
GET /api/v1/analytics/mentors/:mentorId/dashboard
```

---

## 🗄️ Database Schema

### Key Tables

**learning_paths**: Learning path definitions
- Primary key: `id`
- Foreign key: `mentor_id` → `users(id)`
- Indexes: mentor, published, template, tags, difficulty, rating

**milestones**: Milestone structure
- Primary key: `id`
- Foreign key: `learning_path_id` → `learning_paths(id)`
- Unique: `(learning_path_id, order_index)`

**path_enrollments**: Student enrollments
- Primary key: `id`
- Foreign keys: `learning_path_id`, `student_id`
- Unique: `(learning_path_id, student_id)`

**milestone_progress**: Progress tracking
- Primary key: `id`
- Foreign keys: `enrollment_id`, `milestone_id`
- Unique: `(enrollment_id, milestone_id)`

**webhook_subscriptions**: Webhook configurations
- Primary key: `id`
- Foreign key: `user_id` → `users(id)`

---

## 🔐 Authentication & Authorization

### Roles

- **Student**: Can enroll, track progress, view own data
- **Mentor**: Can create paths, view student progress, access analytics
- **Admin**: Full access to all features

### Authorization Examples

```typescript
// In routes
router.get(
  "/learning-paths/:pathId",
  authenticate,
  authorize(["student", "mentor", "admin"]),
  LearningPathController.getPath
);

// In controllers
if (req.user.role !== 'mentor' && req.user.id !== pathOwnerId) {
  throw createError("Access denied", 403);
}
```

---

## 📦 Caching Strategy

### Cache Keys

```typescript
import { CacheKeys, CacheTTL } from './utils/cache-key.utils';

// Learning path
const key = CacheKeys.learningPath(pathId);
await CacheService.set(key, data, CacheTTL.short);

// Student progress
const key = CacheKeys.studentProgress(studentId, pathId);
await CacheService.get(key);

// Analytics
const key = CacheKeys.pathAnalytics(pathId);
await CacheService.del(key); // Invalidate
```

### TTL Presets

- `veryShort`: 30 seconds
- `short`: 1 minute
- `medium`: 5 minutes
- `long`: 1 hour
- `veryLong`: 1 day

---

## 🪝 Webhook Events

### Available Events

```typescript
// Enrollment events
'enrollment.created'
'enrollment.completed'
'enrollment.cancelled'
'enrollment.paused'
'enrollment.resumed'

// Milestone events
'milestone.started'
'milestone.completed'
'milestone.skipped'

// Progress events
'progress.updated'
'progress.milestone_reached'

// Certificate events
'certificate.issued'
'certificate.revoked'

// Session events
'session.scheduled'
'session.completed'
'session.outcome_recorded'

// Path events
'path.published'
'path.unpublished'
'path.updated'

// Analytics events
'analytics.bottleneck_detected'
'analytics.risk_factor_identified'
'analytics.intervention_recommended'
```

---

## 🧪 Testing

### Unit Tests (Coming in Phase 8)

```typescript
describe('LearningPathService', () => {
  it('should create a learning path', async () => {
    const path = await LearningPathService.createPath(mentorId, data);
    expect(path.id).toBeDefined();
    expect(path.title).toBe(data.title);
  });
});
```

### Integration Tests (Coming in Phase 8)

```typescript
describe('POST /api/v1/learning-paths', () => {
  it('should create a learning path', async () => {
    const response = await request(app)
      .post('/api/v1/learning-paths')
      .set('Authorization', `Bearer ${token}`)
      .send(data);
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});
```

---

## 🐛 Debugging

### Logging

```typescript
import { logger } from './utils/logger.utils';

logger.info('Learning path created', { pathId, mentorId });
logger.error('Failed to create path', { error: error.message });
logger.debug('Cache hit', { key });
```

### Error Handling

```typescript
import { createError } from './middleware/errorHandler';

// Throw custom errors
throw createError("Learning path not found", 404);
throw createError("Access denied", 403);
throw createError("Invalid input", 400);
```

---

## 📚 Additional Resources

- **Full API Documentation**: `LEARNING_PATH_API_DOCUMENTATION.md`
- **Implementation Status**: `IMPLEMENTATION_STATUS_FINAL.md`
- **Project Overview**: `LEARNING_PATH_BUILDER_PROJECT_COMPLETE.md`
- **Phase Summaries**: `PHASE_*_COMPLETION_SUMMARY.md`

---

## 🤝 Contributing

### Code Style

- Use TypeScript strict mode
- Follow existing patterns
- Add JSDoc comments
- Handle errors comprehensively
- Log important operations
- Invalidate caches appropriately

### Before Committing

1. Run linter: `npm run lint`
2. Run tests: `npm test` (Phase 8)
3. Check types: `npm run type-check`
4. Update documentation if needed

---

## 🆘 Common Issues

### Issue: Cache not invalidating

**Solution**: Check if all relevant cache keys are being deleted:

```typescript
await Promise.all([
  CacheService.del(CacheKeys.learningPath(pathId)),
  CacheService.del(CacheKeys.mentorPaths(mentorId)),
  CacheService.del(CacheKeys.publishedPaths())
]);
```

### Issue: Webhook not triggering

**Solution**: Ensure webhook service is imported and event is triggered:

```typescript
import { WebhookService } from './services/webhook.service';

await WebhookService.triggerEvent(
  WebhookService.EVENTS.MILESTONE_COMPLETED,
  data
);
```

### Issue: Authorization failing

**Solution**: Check role requirements in route definition:

```typescript
router.get(
  "/path",
  authenticate,
  authorize(["student", "mentor", "admin"]), // Add required roles
  controller.method
);
```

---

## 📞 Support

- **Documentation**: See markdown files in project root
- **Code Questions**: Check service implementations
- **API Questions**: See `LEARNING_PATH_API_DOCUMENTATION.md`

---

**Last Updated**: May 28, 2026
**Version**: 1.0
**Status**: Production Ready (87.5% complete)
