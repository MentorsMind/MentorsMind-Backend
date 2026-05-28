/**
 * Certification Models
 * Data models for mentor certification and verification system
 */

export interface CertificationType {
  id: string;
  name: string;
  category: 'skill' | 'background' | 'platform' | 'professional';
  description: string;
  requirements: Record<string, any>;
  validityPeriodDays: number | null;
  isRequired: boolean;
  isActive: boolean;
  displayOrder: number;
  badgeIcon?: string;
  badgeColor?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MentorCertification {
  id: string;
  mentorId: string;
  certificationTypeId: string;
  status: 'pending' | 'in_review' | 'verified' | 'rejected' | 'expired' | 'revoked';
  verificationMethod?: 'manual' | 'automated' | 'third_party' | 'test' | 'document';
  verifiedBy?: string;
  verifiedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revocationReason?: string;
  score?: number;
  metadata: Record<string, any>;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Populated fields
  certificationType?: CertificationType;
  documents?: CertificationDocument[];
}

export interface CertificationDocument {
  id: string;
  certificationId: string;
  documentType: 'id' | 'degree' | 'certificate' | 'license' | 'portfolio' | 'reference' | 'other';
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  verified: boolean;
  verifiedAt?: Date;
  verifiedBy?: string;
}

export interface SkillTest {
  id: string;
  certificationTypeId: string;
  title: string;
  description: string;
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  durationMinutes: number;
  passingScore: number;
  questions: TestQuestion[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer' | 'code' | 'essay';
  options?: string[];
  correctAnswer?: string | string[];
  points: number;
  explanation?: string;
}

export interface TestAttempt {
  id: string;
  mentorId: string;
  skillTestId: string;
  certificationId?: string;
  status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  score?: number;
  passed?: boolean;
  answers?: Record<string, any>;
  startedAt: Date;
  completedAt?: Date;
  timeSpentMinutes?: number;
  
  // Populated fields
  skillTest?: SkillTest;
}

export interface BackgroundCheck {
  id: string;
  mentorId: string;
  certificationId?: string;
  provider: string;
  checkType: 'criminal' | 'identity' | 'education' | 'employment' | 'professional_license' | 'comprehensive';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  externalReferenceId?: string;
  result?: 'clear' | 'consider' | 'suspended' | 'dispute';
  resultData?: Record<string, any>;
  requestedAt: Date;
  completedAt?: Date;
  cost?: number;
  metadata: Record<string, any>;
}

export interface MentorOnboarding {
  id: string;
  mentorId: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'on_hold';
  currentStep: number;
  totalSteps: number;
  stepsCompleted: string[];
  startedAt?: Date;
  completedAt?: Date;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CertificationReview {
  id: string;
  certificationId: string;
  reviewerId: string;
  reviewType: 'initial' | 'renewal' | 'audit' | 'complaint';
  status: 'pending' | 'approved' | 'rejected' | 'needs_info';
  decision?: 'approve' | 'reject' | 'request_more_info' | 'escalate';
  comments?: string;
  reviewedAt: Date;
  metadata: Record<string, any>;
  
  // Populated fields
  reviewer?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface CertificationReminder {
  id: string;
  certificationId: string;
  reminderType: 'expiring_soon' | 'expired' | 'renewal_available';
  sentAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
}

export interface MentorCertificationSummary {
  mentorId: string;
  totalCertifications: number;
  verifiedCertifications: number;
  pendingCertifications: number;
  expiredCertifications: number;
  certificationLevel: 'basic' | 'intermediate' | 'advanced' | 'expert';
  trustScore: number;
  badges: CertificationBadge[];
  nextExpiringCertification?: {
    name: string;
    expiresAt: Date;
    daysRemaining: number;
  };
}

export interface CertificationBadge {
  id: string;
  name: string;
  category: string;
  icon?: string;
  color?: string;
  verifiedAt: Date;
  expiresAt?: Date;
}

export interface CreateCertificationData {
  mentorId: string;
  certificationTypeId: string;
  verificationMethod?: string;
  metadata?: Record<string, any>;
  notes?: string;
}

export interface UpdateCertificationData {
  status?: MentorCertification['status'];
  verifiedBy?: string;
  score?: number;
  metadata?: Record<string, any>;
  notes?: string;
  revocationReason?: string;
}

export interface SubmitTestAnswersData {
  attemptId: string;
  answers: Record<string, any>;
}

export interface InitiateBackgroundCheckData {
  mentorId: string;
  certificationId?: string;
  checkType: BackgroundCheck['checkType'];
  provider: string;
}
