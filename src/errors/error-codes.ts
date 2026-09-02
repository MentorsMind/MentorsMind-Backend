/**
 * Typed Error Codes
 *
 * Single source of truth for every distinct error scenario exposed by the API.
 * Each code maps to a default (English) message, an HTTP status, and an i18n
 * translation key (`errors.codes.<CODE>` in src/locales/{lng}/errors.json).
 *
 * Consumers:
 *  - `createError(ErrorCode.X, status)` — throwing typed operational errors
 *  - `errorHandler` — resolves localized messages via i18next
 *  - GET /api/v1/errors/catalog — machine-readable catalog endpoint
 *  - SDK type generation (scripts/generate-error-sdk-types.ts)
 */

export enum ErrorCode {
  // ─── Authentication ─────────────────────────────────────────────────────────
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_AUTHENTICATION_REQUIRED = 'AUTH_AUTHENTICATION_REQUIRED',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_ALREADY_REGISTERED = 'AUTH_EMAIL_ALREADY_REGISTERED',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_REFRESH_TOKEN_INVALID = 'AUTH_REFRESH_TOKEN_INVALID',
  AUTH_ACCOUNT_BANNED = 'AUTH_ACCOUNT_BANNED',
  AUTH_ACCOUNT_SUSPENDED = 'AUTH_ACCOUNT_SUSPENDED',
  AUTH_ACCOUNT_INACTIVE = 'AUTH_ACCOUNT_INACTIVE',
  AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED',
  AUTH_EMAIL_NOT_VERIFIED = 'AUTH_EMAIL_NOT_VERIFIED',
  AUTH_MFA_REQUIRED = 'AUTH_MFA_REQUIRED',
  AUTH_MFA_INVALID = 'AUTH_MFA_INVALID',
  AUTH_MFA_TOKEN_INVALID = 'AUTH_MFA_TOKEN_INVALID',
  AUTH_INVALID_RESET_TOKEN = 'AUTH_INVALID_RESET_TOKEN',
  AUTH_PASSWORD_MISMATCH = 'AUTH_PASSWORD_MISMATCH',
  AUTH_WEAK_PASSWORD = 'AUTH_WEAK_PASSWORD',

  // ─── Authorization ──────────────────────────────────────────────────────────
  AUTHZ_FORBIDDEN = 'AUTHZ_FORBIDDEN',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  AUTHZ_ACCESS_DENIED = 'AUTHZ_ACCESS_DENIED',
  AUTHZ_INSUFFICIENT_PERMISSIONS = 'AUTHZ_INSUFFICIENT_PERMISSIONS',
  AUTHZ_ADMIN_ONLY = 'AUTHZ_ADMIN_ONLY',
  AUTHZ_RESOURCE_OWNERSHIP_REQUIRED = 'AUTHZ_RESOURCE_OWNERSHIP_REQUIRED',

  // ─── Bookings ───────────────────────────────────────────────────────────────
  BOOKING_CONFLICT = 'BOOKING_CONFLICT',
  BOOKING_NOT_FOUND = 'BOOKING_NOT_FOUND',
  BOOKING_MENTEE_NOT_FOUND = 'BOOKING_MENTEE_NOT_FOUND',
  BOOKING_MENTOR_NOT_FOUND = 'BOOKING_MENTOR_NOT_FOUND',
  BOOKING_USER_SUSPENDED = 'BOOKING_USER_SUSPENDED',
  BOOKING_USER_BANNED = 'BOOKING_USER_BANNED',
  BOOKING_USER_NOT_A_MENTOR = 'BOOKING_USER_NOT_A_MENTOR',
  BOOKING_MENTOR_PROFILE_NOT_FOUND = 'BOOKING_MENTOR_PROFILE_NOT_FOUND',
  BOOKING_HOURLY_RATE_NOT_SET = 'BOOKING_HOURLY_RATE_NOT_SET',
  BOOKING_INVALID_STATUS = 'BOOKING_INVALID_STATUS',
  BOOKING_ONLY_MENTEE_CAN_UPDATE = 'BOOKING_ONLY_MENTEE_CAN_UPDATE',
  BOOKING_ONLY_MENTOR_CAN_CONFIRM = 'BOOKING_ONLY_MENTOR_CAN_CONFIRM',
  BOOKING_NOT_PENDING = 'BOOKING_NOT_PENDING',
  BOOKING_PAYMENT_REQUIRED_BEFORE_CONFIRMATION = 'BOOKING_PAYMENT_REQUIRED_BEFORE_CONFIRMATION',
  BOOKING_NOT_CONFIRMED = 'BOOKING_NOT_CONFIRMED',
  BOOKING_SESSION_NOT_ENDED = 'BOOKING_SESSION_NOT_ENDED',
  BOOKING_ALREADY_CANCELLED = 'BOOKING_ALREADY_CANCELLED',
  BOOKING_RESCHEDULE_NOT_ALLOWED = 'BOOKING_RESCHEDULE_NOT_ALLOWED',
  BOOKING_UPDATE_FAILED = 'BOOKING_UPDATE_FAILED',
  BOOKING_CONFIRM_FAILED = 'BOOKING_CONFIRM_FAILED',
  BOOKING_COMPLETION_FAILED = 'BOOKING_COMPLETION_FAILED',
  BOOKING_CANCELLATION_FAILED = 'BOOKING_CANCELLATION_FAILED',
  BOOKING_RESCHEDULE_FAILED = 'BOOKING_RESCHEDULE_FAILED',

  // ─── Payments ───────────────────────────────────────────────────────────────
  PAYMENT_BOOKING_NOT_FOUND = 'PAYMENT_BOOKING_NOT_FOUND',
  PAYMENT_ACCESS_DENIED = 'PAYMENT_ACCESS_DENIED',
  PAYMENT_ALREADY_COMPLETED = 'PAYMENT_ALREADY_COMPLETED',
  PAYMENT_ALREADY_CONFIRMED = 'PAYMENT_ALREADY_CONFIRMED',
  PAYMENT_ALREADY_REFUNDED = 'PAYMENT_ALREADY_REFUNDED',
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  PAYMENT_INVALID_STATUS = 'PAYMENT_INVALID_STATUS',
  PAYMENT_REFUND_NOT_ALLOWED = 'PAYMENT_REFUND_NOT_ALLOWED',
  PAYMENT_UNSUPPORTED_CURRENCY = 'PAYMENT_UNSUPPORTED_CURRENCY',
  PAYMENT_INVALID_TX_HASH = 'PAYMENT_INVALID_TX_HASH',
  PAYMENT_TX_VERIFICATION_FAILED = 'PAYMENT_TX_VERIFICATION_FAILED',
  PAYMENT_TX_TOO_OLD = 'PAYMENT_TX_TOO_OLD',
  PAYMENT_TX_NOT_SUCCESSFUL = 'PAYMENT_TX_NOT_SUCCESSFUL',
  PAYMENT_SOURCE_ACCOUNT_MISMATCH = 'PAYMENT_SOURCE_ACCOUNT_MISMATCH',
  PAYMENT_NO_MATCHING_OPERATION = 'PAYMENT_NO_MATCHING_OPERATION',
  PAYMENT_CONFIRM_FAILED = 'PAYMENT_CONFIRM_FAILED',
  PAYMENT_QUOTE_EXPIRED = 'PAYMENT_QUOTE_EXPIRED',

  // ─── Escrow ─────────────────────────────────────────────────────────────────
  ESCROW_NOT_FOUND = 'ESCROW_NOT_FOUND',
  ESCROW_CREATION_FAILED = 'ESCROW_CREATION_FAILED',
  ESCROW_RELEASE_FAILED = 'ESCROW_RELEASE_FAILED',
  ESCROW_REFUND_FAILED = 'ESCROW_REFUND_FAILED',
  ESCROW_ALREADY_RELEASED = 'ESCROW_ALREADY_RELEASED',
  ESCROW_DISPUTE_RESOLUTION_FAILED = 'ESCROW_DISPUTE_RESOLUTION_FAILED',
  ESCROW_METADATA_MISSING = 'ESCROW_METADATA_MISSING',

  // ─── Disputes ───────────────────────────────────────────────────────────────
  DISPUTE_SESSION_NOT_FOUND = 'DISPUTE_SESSION_NOT_FOUND',
  DISPUTE_NOT_FOUND = 'DISPUTE_NOT_FOUND',
  DISPUTE_CREATION_FAILED = 'DISPUTE_CREATION_FAILED',
  DISPUTE_UNAUTHORIZED = 'DISPUTE_UNAUTHORIZED',
  DISPUTE_ESCROW_MISSING = 'DISPUTE_ESCROW_MISSING',
  DISPUTE_INVALID_STATUS_TRANSITION = 'DISPUTE_INVALID_STATUS_TRANSITION',
  DISPUTE_UPDATE_FAILED = 'DISPUTE_UPDATE_FAILED',

  // ─── Users ──────────────────────────────────────────────────────────────────
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_ACCESS_DENIED = 'USER_ACCESS_DENIED',
  USER_UPDATE_FAILED = 'USER_UPDATE_FAILED',
  USER_PROFILE_INCOMPLETE = 'USER_PROFILE_INCOMPLETE',
  USER_DEACTIVATION_FAILED = 'USER_DEACTIVATION_FAILED',
  USER_PII_ENCRYPTION_FAILED = 'USER_PII_ENCRYPTION_FAILED',

  // ─── Mentors ────────────────────────────────────────────────────────────────
  MENTOR_NOT_FOUND = 'MENTOR_NOT_FOUND',
  MENTOR_NOT_AVAILABLE = 'MENTOR_NOT_AVAILABLE',
  MENTOR_PROFILE_UPDATE_FAILED = 'MENTOR_PROFILE_UPDATE_FAILED',
  MENTOR_VERIFICATION_PENDING = 'MENTOR_VERIFICATION_PENDING',
  MENTOR_INVALID_GROUP_BY = 'MENTOR_INVALID_GROUP_BY',

  // ─── Validation ─────────────────────────────────────────────────────────────
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  VALIDATION_REQUIRED_FIELD = 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_MISSING_REQUIRED = 'VALIDATION_MISSING_REQUIRED',
  VALIDATION_INVALID_FORMAT = 'VALIDATION_INVALID_FORMAT',
  VALIDATION_OUT_OF_RANGE = 'VALIDATION_OUT_OF_RANGE',
  VALIDATION_PROGRESS_OUT_OF_RANGE = 'VALIDATION_PROGRESS_OUT_OF_RANGE',
  VALIDATION_INVALID_TIMEFRAME = 'VALIDATION_INVALID_TIMEFRAME',
  VALIDATION_MISSING_QUERY_PARAMS = 'VALIDATION_MISSING_QUERY_PARAMS',
  VALIDATION_MISSING_OAUTH_STATE = 'VALIDATION_MISSING_OAUTH_STATE',
  VALIDATION_INVALID_OAUTH_STATE = 'VALIDATION_INVALID_OAUTH_STATE',

  // ─── OAuth / Integrations ───────────────────────────────────────────────────
  OAUTH_GOOGLE_ERROR = 'OAUTH_GOOGLE_ERROR',
  OAUTH_CSRF_TOKEN_INVALID = 'OAUTH_CSRF_TOKEN_INVALID',
  INTEGRATION_JOB_NOT_FOUND = 'INTEGRATION_JOB_NOT_FOUND',
  ZAPIER_SCOPE_MISSING = 'ZAPIER_SCOPE_MISSING',

  // ─── Uploads / Attachments ──────────────────────────────────────────────────
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  UPLOAD_FILE_TOO_LARGE = 'UPLOAD_FILE_TOO_LARGE',
  UPLOAD_INVALID_TYPE = 'UPLOAD_INVALID_TYPE',
  UPLOAD_QUOTA_EXCEEDED = 'UPLOAD_QUOTA_EXCEEDED',

  // ─── Rate limiting ──────────────────────────────────────────────────────────
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // ─── Infrastructure / Generic ───────────────────────────────────────────────
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  DATABASE_QUERY_TIMEOUT = 'DATABASE_QUERY_TIMEOUT',
  DATABASE_UNIQUE_VIOLATION = 'DATABASE_UNIQUE_VIOLATION',
  DATABASE_FOREIGN_KEY_VIOLATION = 'DATABASE_FOREIGN_KEY_VIOLATION',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  MAINTENANCE_MODE = 'MAINTENANCE_MODE',

  // ─── Learning Paths ─────────────────────────────────────────────────────────
  LEARNING_PATH_NOT_FOUND = 'LEARNING_PATH_NOT_FOUND',
  LEARNING_PATH_NOT_PUBLISHED = 'LEARNING_PATH_NOT_PUBLISHED',
  LEARNING_PATH_ALREADY_PUBLISHED = 'LEARNING_PATH_ALREADY_PUBLISHED',
  LEARNING_PATH_HAS_ACTIVE_ENROLLMENTS = 'LEARNING_PATH_HAS_ACTIVE_ENROLLMENTS',
  LEARNING_PATH_NO_MILESTONES = 'LEARNING_PATH_NO_MILESTONES',
  LEARNING_PATH_CLONING_NOT_ALLOWED = 'LEARNING_PATH_CLONING_NOT_ALLOWED',
  LEARNING_PATH_TEMPLATE_NOT_FOUND = 'LEARNING_PATH_TEMPLATE_NOT_FOUND',
  LEARNING_PATH_UPDATE_FAILED = 'LEARNING_PATH_UPDATE_FAILED',
  LEARNING_PATH_DELETE_FAILED = 'LEARNING_PATH_DELETE_FAILED',
  LEARNING_PATH_PUBLISH_FAILED = 'LEARNING_PATH_PUBLISH_FAILED',
  LEARNING_PATH_UNPUBLISH_FAILED = 'LEARNING_PATH_UNPUBLISH_FAILED',
  LEARNING_PATH_NOT_ENROLLED = 'LEARNING_PATH_NOT_ENROLLED',
  LEARNING_PATH_NOT_COMPLETED = 'LEARNING_PATH_NOT_COMPLETED',
  LEARNING_PATH_INVALID_STATUS = 'LEARNING_PATH_INVALID_STATUS',
  PATH_ID_REQUIRED = 'PATH_ID_REQUIRED',
  MILESTONE_ID_REQUIRED = 'MILESTONE_ID_REQUIRED',

  // ─── Enrollment ─────────────────────────────────────────────────────────────
  ENROLLMENT_NOT_FOUND = 'ENROLLMENT_NOT_FOUND',
  ENROLLMENT_ALREADY_EXISTS = 'ENROLLMENT_ALREADY_EXISTS',
  ENROLLMENT_ALREADY_UNENROLLED = 'ENROLLMENT_ALREADY_UNENROLLED',
  ENROLLMENT_STATUS_TRANSITION_INVALID = 'ENROLLMENT_STATUS_TRANSITION_INVALID',
  ENROLLMENT_UPDATE_FAILED = 'ENROLLMENT_UPDATE_FAILED',
  ENROLLMENT_INACTIVE = 'ENROLLMENT_INACTIVE',
  STUDENT_NOT_FOUND = 'STUDENT_NOT_FOUND',
  STUDENT_ACCOUNT_INACTIVE = 'STUDENT_ACCOUNT_INACTIVE',
  ENROLLMENT_ACCESS_DENIED = 'ENROLLMENT_ACCESS_DENIED',

  // ─── Milestones ─────────────────────────────────────────────────────────────
  MILESTONE_NOT_FOUND = 'MILESTONE_NOT_FOUND',
  MILESTONE_ALREADY_COMPLETED = 'MILESTONE_ALREADY_COMPLETED',
  MILESTONE_COMPLETION_FAILED = 'MILESTONE_COMPLETION_FAILED',
  MILESTONE_PREREQUISITES_NOT_MET = 'MILESTONE_PREREQUISITES_NOT_MET',
  MILESTONE_STEP_PREREQUISITES_NOT_MET = 'MILESTONE_STEP_PREREQUISITES_NOT_MET',
  MILESTONE_STEP_INVALID = 'MILESTONE_STEP_INVALID',
  MILESTONE_ACCESS_DENIED = 'MILESTONE_ACCESS_DENIED',
  MILESTONE_COMPLETION_CRITERIA_NOT_MET = 'MILESTONE_COMPLETION_CRITERIA_NOT_MET',
  MILESTONE_SKIP_REQUIRES_MENTOR_APPROVAL = 'MILESTONE_SKIP_REQUIRES_MENTOR_APPROVAL',
  PREREQUISITE_NOT_FOUND = 'PREREQUISITE_NOT_FOUND',
  PREREQUISITE_OVERRIDE_NOT_FOUND = 'PREREQUISITE_OVERRIDE_NOT_FOUND',
  PREREQUISITE_OVERRIDE_EXISTS = 'PREREQUISITE_OVERRIDE_EXISTS',
  PREREQUISITE_OVERRIDE_PERMISSION_DENIED = 'PREREQUISITE_OVERRIDE_PERMISSION_DENIED',

  // ─── Certifications / Certificates ──────────────────────────────────────────
  CERTIFICATION_TYPE_NOT_FOUND = 'CERTIFICATION_TYPE_NOT_FOUND',
  CERTIFICATION_NOT_FOUND = 'CERTIFICATION_NOT_FOUND',
  CERTIFICATION_ALREADY_EXISTS = 'CERTIFICATION_ALREADY_EXISTS',
  CERTIFICATE_NOT_FOUND = 'CERTIFICATE_NOT_FOUND',
  CERTIFICATE_ALREADY_EXISTS = 'CERTIFICATE_ALREADY_EXISTS',
  CERTIFICATE_REVOKE_PERMISSION_DENIED = 'CERTIFICATE_REVOKE_PERMISSION_DENIED',
  CERTIFICATE_MILESTONES_INCOMPLETE = 'CERTIFICATE_MILESTONES_INCOMPLETE',

  // ─── Reviews ────────────────────────────────────────────────────────────────
  REVIEW_NOT_FOUND = 'REVIEW_NOT_FOUND',
  REVIEW_ALREADY_EXISTS = 'REVIEW_ALREADY_EXISTS',
  REVIEW_VOTE_DUPLICATE = 'REVIEW_VOTE_DUPLICATE',
  REVIEW_FLAG_DUPLICATE = 'REVIEW_FLAG_DUPLICATE',
  REVIEW_SELF_INTERACTION_FORBIDDEN = 'REVIEW_SELF_INTERACTION_FORBIDDEN',
  REVIEW_RESPONSE_NOT_FOUND = 'REVIEW_RESPONSE_NOT_FOUND',
  REVIEW_RESPONSE_CREATE_FAILED = 'REVIEW_RESPONSE_CREATE_FAILED',
  REVIEW_EDIT_FORBIDDEN = 'REVIEW_EDIT_FORBIDDEN',
  REVIEW_DELETE_FORBIDDEN = 'REVIEW_DELETE_FORBIDDEN',
  SELF_REVIEW_FORBIDDEN = 'SELF_REVIEW_FORBIDDEN',

  // ─── Study Groups / Forums ──────────────────────────────────────────────────
  STUDY_GROUP_NOT_FOUND = 'STUDY_GROUP_NOT_FOUND',
  STUDY_GROUP_FULL = 'STUDY_GROUP_FULL',
  STUDY_GROUP_MEMBER_EXISTS = 'STUDY_GROUP_MEMBER_EXISTS',
  STUDY_GROUP_ENROLLMENT_REQUIRED = 'STUDY_GROUP_ENROLLMENT_REQUIRED',
  FORUM_NOT_FOUND = 'FORUM_NOT_FOUND',
  FORUM_ALREADY_EXISTS = 'FORUM_ALREADY_EXISTS',
  FORUM_POST_DENIED = 'FORUM_POST_DENIED',

  // ─── Payments (learning-path purchases, etc.) ───────────────────────────────
  PAYMENT_REFERENCE_ALREADY_USED = 'PAYMENT_REFERENCE_ALREADY_USED',
  PAYMENT_INSUFFICIENT_AMOUNT = 'PAYMENT_INSUFFICIENT_AMOUNT',
  PAYMENT_CURRENCY_MISMATCH = 'PAYMENT_CURRENCY_MISMATCH',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  PAYMENT_UNSUCCESSFUL = 'PAYMENT_UNSUCCESSFUL',

  // ─── Referrals / Affiliates ─────────────────────────────────────────────────
  REFERRAL_NOT_FOUND = 'REFERRAL_NOT_FOUND',
  REFERRAL_CODE_REQUIRED = 'REFERRAL_CODE_REQUIRED',
  REFERRAL_CODE_INVALID = 'REFERRAL_CODE_INVALID',
  REFERRAL_CODE_GENERATION_FAILED = 'REFERRAL_CODE_GENERATION_FAILED',
  REFERRAL_CODE_ALREADY_ACTIVE = 'REFERRAL_CODE_ALREADY_ACTIVE',
  AFFILIATE_PROFILE_NOT_FOUND = 'AFFILIATE_PROFILE_NOT_FOUND',
  AFFILIATE_PROFILE_EXISTS = 'AFFILIATE_PROFILE_EXISTS',

  // ─── API Keys / Integrations ────────────────────────────────────────────────
  API_KEY_NOT_FOUND = 'API_KEY_NOT_FOUND',

  // ─── Onboarding ─────────────────────────────────────────────────────────────
  ONBOARDING_NOT_FOUND = 'ONBOARDING_NOT_FOUND',
  ONBOARDING_ALREADY_COMPLETED = 'ONBOARDING_ALREADY_COMPLETED',
  ONBOARDING_NOT_PAUSED = 'ONBOARDING_NOT_PAUSED',
  ONBOARDING_RATE_LIMITED = 'ONBOARDING_RATE_LIMITED',
  ONBOARDING_STEP_INVALID = 'ONBOARDING_STEP_INVALID',
  ONBOARDING_STEP_ALREADY_COMPLETED = 'ONBOARDING_STEP_ALREADY_COMPLETED',
  ONBOARDING_STEP_PREREQUISITES_NOT_MET = 'ONBOARDING_STEP_PREREQUISITES_NOT_MET',
  CHECKLIST_ITEM_NOT_FOUND = 'CHECKLIST_ITEM_NOT_FOUND',

  // ─── Skill Tests ────────────────────────────────────────────────────────────
  SKILL_TEST_NOT_FOUND = 'SKILL_TEST_NOT_FOUND',
  TEST_ATTEMPT_NOT_FOUND = 'TEST_ATTEMPT_NOT_FOUND',
  TEST_ATTEMPT_IN_PROGRESS = 'TEST_ATTEMPT_IN_PROGRESS',
  TEST_ATTEMPT_NOT_IN_PROGRESS = 'TEST_ATTEMPT_NOT_IN_PROGRESS',
  TEST_ANSWERS_REQUIRED = 'TEST_ANSWERS_REQUIRED',

  // ─── Sessions / Outcomes ────────────────────────────────────────────────────
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_OUTCOME_NOT_FOUND = 'SESSION_OUTCOME_NOT_FOUND',
  SESSION_OUTCOME_INVALID_STATE = 'SESSION_OUTCOME_INVALID_STATE',
  SESSION_MILESTONE_LINK_MISSING = 'SESSION_MILESTONE_LINK_MISSING',
  SESSION_MILESTONE_ALREADY_LINKED = 'SESSION_MILESTONE_ALREADY_LINKED',
  SESSION_NOT_AUTHORIZED = 'SESSION_NOT_AUTHORIZED',

  // ─── Session Templates ─────────────────────────────────────────────────────
  SESSION_TEMPLATE_NOT_FOUND = 'SESSION_TEMPLATE_NOT_FOUND',
  SESSION_TEMPLATE_UPDATE_FAILED = 'SESSION_TEMPLATE_UPDATE_FAILED',
  SESSION_TEMPLATE_DELETE_FAILED = 'SESSION_TEMPLATE_DELETE_FAILED',
  SESSION_TEMPLATE_HAS_USAGE = 'SESSION_TEMPLATE_HAS_USAGE',
  SESSION_TEMPLATE_CREATION_FAILED = 'SESSION_TEMPLATE_CREATION_FAILED',
  SESSION_TEMPLATE_CLONE_FAILED = 'SESSION_TEMPLATE_CLONE_FAILED',

  // ─── Session Quality ───────────────────────────────────────────────────────
  SESSION_QUALITY_ASSESSMENT_FAILED = 'SESSION_QUALITY_ASSESSMENT_FAILED',
  SESSION_QUALITY_NOT_FOUND = 'SESSION_QUALITY_NOT_FOUND',
  SESSION_QUALITY_INVALID_INPUT = 'SESSION_QUALITY_INVALID_INPUT',

  // ─── Dispute Resolution ────────────────────────────────────────────────────
  DISPUTE_EVIDENCE_UPLOAD_FAILED = 'DISPUTE_EVIDENCE_UPLOAD_FAILED',
  DISPUTE_EVIDENCE_NOT_FOUND = 'DISPUTE_EVIDENCE_NOT_FOUND',
  DISPUTE_MEDIATION_FAILED = 'DISPUTE_MEDIATION_FAILED',
  DISPUTE_RESOLUTION_FAILED = 'DISPUTE_RESOLUTION_FAILED',
  DISPUTE_ALREADY_RESOLVED = 'DISPUTE_ALREADY_RESOLVED',
  DISPUTE_EVIDENCE_LIMIT_EXCEEDED = 'DISPUTE_EVIDENCE_LIMIT_EXCEEDED',

  // ─── Internationalization ───────────────────────────────────────────────────
  I18N_TRANSLATION_NOT_FOUND = 'I18N_TRANSLATION_NOT_FOUND',
  I18N_LANGUAGE_NOT_SUPPORTED = 'I18N_LANGUAGE_NOT_SUPPORTED',
  I18N_TRANSLATION_UPDATE_FAILED = 'I18N_TRANSLATION_UPDATE_FAILED',
  I18N_RTL_SUPPORT_ERROR = 'I18N_RTL_SUPPORT_ERROR',

  // ─── Background Checks ──────────────────────────────────────────────────────
  BACKGROUND_CHECK_NOT_FOUND = 'BACKGROUND_CHECK_NOT_FOUND',
  BACKGROUND_CHECK_ALREADY_IN_PROGRESS = 'BACKGROUND_CHECK_ALREADY_IN_PROGRESS',
  BACKGROUND_CHECK_SIMULATION_DISABLED = 'BACKGROUND_CHECK_SIMULATION_DISABLED',
  BACKGROUND_CHECK_INPUT_REQUIRED = 'BACKGROUND_CHECK_INPUT_REQUIRED',

  // ─── Bulk / CSV ─────────────────────────────────────────────────────────────
  BULK_CSV_VALIDATION_FAILED = 'BULK_CSV_VALIDATION_FAILED',
  BULK_CSV_COLUMN_MISSING = 'BULK_CSV_COLUMN_MISSING',

  // ─── Oracle / iCal / MFA / Misc domain ──────────────────────────────────────
  ORACLE_NOT_CONFIGURED = 'ORACLE_NOT_CONFIGURED',
  ICAL_TOKEN_INVALID = 'ICAL_TOKEN_INVALID',
  ICAL_RATE_LIMIT_EXCEEDED = 'ICAL_RATE_LIMIT_EXCEEDED',
  MFA_PHONE_NUMBER_REQUIRED = 'MFA_PHONE_NUMBER_REQUIRED',
  INVALID_CURSOR = 'INVALID_CURSOR',
  ASSET_UNSUPPORTED = 'ASSET_UNSUPPORTED',
  ASSET_INVALID_SEND_AMOUNT = 'ASSET_INVALID_SEND_AMOUNT',
  QUOTE_EXPIRED_OR_NOT_FOUND = 'QUOTE_EXPIRED_OR_NOT_FOUND',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  QUOTE_RATE_MOVED = 'QUOTE_RATE_MOVED',
  SDEX_LIQUIDITY_UNAVAILABLE = 'SDEX_LIQUIDITY_UNAVAILABLE',
  PAYOUT_MINIMUM_NOT_MET = 'PAYOUT_MINIMUM_NOT_MET',
  GOAL_NOT_FOUND = 'GOAL_NOT_FOUND',
  GOAL_UPDATE_FAILED = 'GOAL_UPDATE_FAILED',
  WEBHOOK_PAYLOAD_INVALID = 'WEBHOOK_PAYLOAD_INVALID',
  SUBMISSION_NOT_FOUND = 'SUBMISSION_NOT_FOUND',
  SUBMISSION_ANSWERS_REQUIRED = 'SUBMISSION_ANSWERS_REQUIRED',
}

/** Shape of one entry in the machine-readable error catalog. */
export interface ErrorCatalogEntry {
  /** Stable machine-readable identifier (value of ErrorCode). */
  code: ErrorCode;
  /** Default (English) human-readable message. */
  message: string;
  /** HTTP status code this error is raised with by default. */
  httpStatus: number;
  /** i18n lookup key: `errors.codes.<CODE>` in src/locales/{lng}/errors.json */
  i18nKey: string;
}

function entry(code: ErrorCode, httpStatus: number, message: string): [ErrorCode, ErrorCatalogEntry] {
  return [code, { code, httpStatus, message, i18nKey: `codes.${code}` }];
}

/**
 * Machine-readable error catalog.
 * Keyed by ErrorCode — every value carries its default English message,
 * default HTTP status, and i18n key.
 */
export const ERROR_CATALOG = Object.fromEntries([
  // ─── Authentication ─────────────────────────────────────────────────────────
  entry(ErrorCode.AUTH_UNAUTHORIZED, 401, 'Unauthorized access'),
  entry(ErrorCode.AUTH_REQUIRED, 401, 'Authentication required'),
  entry(ErrorCode.AUTH_AUTHENTICATION_REQUIRED, 401, 'Authentication required'),
  entry(ErrorCode.AUTH_INVALID_CREDENTIALS, 401, 'Invalid email or password'),
  entry(ErrorCode.AUTH_EMAIL_ALREADY_REGISTERED, 409, 'Email is already registered'),
  entry(ErrorCode.AUTH_TOKEN_EXPIRED, 401, 'Session expired. Please login again'),
  entry(ErrorCode.AUTH_TOKEN_INVALID, 401, 'Invalid session token'),
  entry(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 401, 'Invalid or expired refresh token'),
  entry(ErrorCode.AUTH_ACCOUNT_BANNED, 403, 'Your account has been permanently banned. Please contact support if you believe this is an error.'),
  entry(ErrorCode.AUTH_ACCOUNT_SUSPENDED, 403, 'Your account has been suspended. Please contact support for more information.'),
  entry(ErrorCode.AUTH_ACCOUNT_INACTIVE, 403, 'Account is not active'),
  entry(ErrorCode.AUTH_ACCOUNT_LOCKED, 423, 'Account has been locked'),
  entry(ErrorCode.AUTH_EMAIL_NOT_VERIFIED, 403, 'Email address not verified'),
  entry(ErrorCode.AUTH_MFA_REQUIRED, 401, 'Two-factor authentication required'),
  entry(ErrorCode.AUTH_MFA_INVALID, 401, 'Invalid verification code'),
  entry(ErrorCode.AUTH_MFA_TOKEN_INVALID, 401, 'Invalid or expired MFA token'),
  entry(ErrorCode.AUTH_INVALID_RESET_TOKEN, 400, 'Invalid or expired reset token'),
  entry(ErrorCode.AUTH_PASSWORD_MISMATCH, 400, 'Passwords do not match'),
  entry(ErrorCode.AUTH_WEAK_PASSWORD, 400, 'Password is too weak'),

  // ─── Authorization ──────────────────────────────────────────────────────────
  entry(ErrorCode.AUTHZ_FORBIDDEN, 403, 'Access denied'),
  entry(ErrorCode.AUTH_FORBIDDEN, 403, 'Access denied'),
  entry(ErrorCode.AUTHZ_ACCESS_DENIED, 403, 'You do not have access to this resource'),
  entry(ErrorCode.AUTHZ_INSUFFICIENT_PERMISSIONS, 403, "You don't have permission to perform this action"),
  entry(ErrorCode.AUTHZ_ADMIN_ONLY, 403, 'This action requires administrator privileges'),
  entry(ErrorCode.AUTHZ_RESOURCE_OWNERSHIP_REQUIRED, 403, 'Only the resource owner can perform this action'),

  // ─── Bookings ───────────────────────────────────────────────────────────────
  entry(ErrorCode.BOOKING_CONFLICT, 409, 'Mentor is not available at the requested time'),
  entry(ErrorCode.BOOKING_NOT_FOUND, 404, 'Booking not found'),
  entry(ErrorCode.BOOKING_MENTEE_NOT_FOUND, 404, 'Mentee not found'),
  entry(ErrorCode.BOOKING_MENTOR_NOT_FOUND, 404, 'Mentor not found'),
  entry(ErrorCode.BOOKING_USER_SUSPENDED, 403, 'Your account is suspended. You cannot create bookings at this time.'),
  entry(ErrorCode.BOOKING_USER_BANNED, 403, 'Your account has been permanently banned.'),
  entry(ErrorCode.BOOKING_USER_NOT_A_MENTOR, 400, 'User is not a mentor'),
  entry(ErrorCode.BOOKING_MENTOR_PROFILE_NOT_FOUND, 404, 'Mentor profile or hourly rate not found'),
  entry(ErrorCode.BOOKING_HOURLY_RATE_NOT_SET, 404, 'Mentor profile or hourly rate not found'),
  entry(ErrorCode.BOOKING_INVALID_STATUS, 400, 'Cannot update booking in current status'),
  entry(ErrorCode.BOOKING_ONLY_MENTEE_CAN_UPDATE, 403, 'Only the mentee can update booking details'),
  entry(ErrorCode.BOOKING_ONLY_MENTOR_CAN_CONFIRM, 403, 'Only the mentor can confirm bookings'),
  entry(ErrorCode.BOOKING_NOT_PENDING, 400, 'Booking is not in pending status'),
  entry(ErrorCode.BOOKING_PAYMENT_REQUIRED_BEFORE_CONFIRMATION, 400, 'Payment must be completed before confirmation'),
  entry(ErrorCode.BOOKING_NOT_CONFIRMED, 400, 'Only confirmed bookings can be completed'),
  entry(ErrorCode.BOOKING_SESSION_NOT_ENDED, 400, 'Cannot complete booking before session ends'),
  entry(ErrorCode.BOOKING_ALREADY_CANCELLED, 400, 'Cannot cancel booking in current status'),
  entry(ErrorCode.BOOKING_RESCHEDULE_NOT_ALLOWED, 400, 'Cannot reschedule booking in current status'),
  entry(ErrorCode.BOOKING_UPDATE_FAILED, 500, 'Failed to update booking'),
  entry(ErrorCode.BOOKING_CONFIRM_FAILED, 500, 'Failed to confirm booking'),
  entry(ErrorCode.BOOKING_COMPLETION_FAILED, 500, 'Failed to complete booking'),
  entry(ErrorCode.BOOKING_CANCELLATION_FAILED, 500, 'Failed to cancel booking'),
  entry(ErrorCode.BOOKING_RESCHEDULE_FAILED, 500, 'Failed to reschedule booking'),

  // ─── Payments ───────────────────────────────────────────────────────────────
  entry(ErrorCode.PAYMENT_BOOKING_NOT_FOUND, 404, 'Booking not found'),
  entry(ErrorCode.PAYMENT_ACCESS_DENIED, 403, 'Access denied'),
  entry(ErrorCode.PAYMENT_ALREADY_COMPLETED, 409, 'Booking is already paid'),
  entry(ErrorCode.PAYMENT_ALREADY_CONFIRMED, 409, 'Payment already confirmed'),
  entry(ErrorCode.PAYMENT_ALREADY_REFUNDED, 409, 'Payment already refunded'),
  entry(ErrorCode.PAYMENT_NOT_FOUND, 404, 'Payment not found'),
  entry(ErrorCode.PAYMENT_INVALID_STATUS, 400, 'Payment cannot be processed in its current status'),
  entry(ErrorCode.PAYMENT_REFUND_NOT_ALLOWED, 400, 'Only completed payments can be refunded'),
  entry(ErrorCode.PAYMENT_UNSUPPORTED_CURRENCY, 400, 'Unsupported currency'),
  entry(ErrorCode.PAYMENT_INVALID_TX_HASH, 400, 'Invalid Stellar transaction hash format'),
  entry(ErrorCode.PAYMENT_TX_VERIFICATION_FAILED, 400, 'Unable to verify transaction on Stellar network'),
  entry(ErrorCode.PAYMENT_TX_TOO_OLD, 400, 'Transaction is too old to confirm (must be within 24 hours)'),
  entry(ErrorCode.PAYMENT_TX_NOT_SUCCESSFUL, 400, 'Stellar transaction was not successful'),
  entry(ErrorCode.PAYMENT_SOURCE_ACCOUNT_MISMATCH, 400, 'Transaction source account does not match payment sender'),
  entry(ErrorCode.PAYMENT_NO_MATCHING_OPERATION, 400, 'Transaction does not contain a matching payment operation'),
  entry(ErrorCode.PAYMENT_CONFIRM_FAILED, 500, 'Failed to confirm payment'),
  entry(ErrorCode.PAYMENT_QUOTE_EXPIRED, 400, 'Quote has expired or is invalid'),

  // ─── Escrow ─────────────────────────────────────────────────────────────────
  entry(ErrorCode.ESCROW_NOT_FOUND, 404, 'Escrow not found'),
  entry(ErrorCode.ESCROW_CREATION_FAILED, 500, 'Failed to create escrow'),
  entry(ErrorCode.ESCROW_RELEASE_FAILED, 500, 'Failed to release escrow funds'),
  entry(ErrorCode.ESCROW_REFUND_FAILED, 500, 'Failed to refund escrow funds'),
  entry(ErrorCode.ESCROW_ALREADY_RELEASED, 409, 'Escrow funds have already been released'),
  entry(ErrorCode.ESCROW_DISPUTE_RESOLUTION_FAILED, 500, 'Failed to resolve escrow dispute'),
  entry(ErrorCode.ESCROW_METADATA_MISSING, 400, 'No escrow metadata found on booking'),

  // ─── Disputes ───────────────────────────────────────────────────────────────
  entry(ErrorCode.DISPUTE_SESSION_NOT_FOUND, 404, 'Session not found'),
  entry(ErrorCode.DISPUTE_NOT_FOUND, 404, 'Dispute not found'),
  entry(ErrorCode.DISPUTE_CREATION_FAILED, 500, 'Failed to create dispute'),
  entry(ErrorCode.DISPUTE_UNAUTHORIZED, 403, 'Unauthorized: You are not a party to this dispute'),
  entry(ErrorCode.DISPUTE_ESCROW_MISSING, 400, 'No escrow found for booking'),
  entry(ErrorCode.DISPUTE_INVALID_STATUS_TRANSITION, 409, 'Dispute cannot transition to the requested status'),
  entry(ErrorCode.DISPUTE_UPDATE_FAILED, 500, 'Failed to update dispute status'),

  // ─── Users ──────────────────────────────────────────────────────────────────
  entry(ErrorCode.USER_NOT_FOUND, 404, 'User not found'),
  entry(ErrorCode.USER_ACCESS_DENIED, 403, 'Access denied'),
  entry(ErrorCode.USER_UPDATE_FAILED, 500, 'Failed to update user'),
  entry(ErrorCode.USER_PROFILE_INCOMPLETE, 400, 'User profile is incomplete'),
  entry(ErrorCode.USER_DEACTIVATION_FAILED, 500, 'Failed to deactivate account'),
  entry(ErrorCode.USER_PII_ENCRYPTION_FAILED, 500, 'Failed to encrypt personal data'),

  // ─── Mentors ────────────────────────────────────────────────────────────────
  entry(ErrorCode.MENTOR_NOT_FOUND, 404, 'Mentor not found'),
  entry(ErrorCode.MENTOR_NOT_AVAILABLE, 400, 'This mentor is not currently available for bookings'),
  entry(ErrorCode.MENTOR_PROFILE_UPDATE_FAILED, 500, 'Failed to update mentor profile'),
  entry(ErrorCode.MENTOR_VERIFICATION_PENDING, 403, 'Mentor verification is pending review'),
  entry(ErrorCode.MENTOR_INVALID_GROUP_BY, 400, 'Invalid groupBy value'),

  // ─── Validation ─────────────────────────────────────────────────────────────
  entry(ErrorCode.VALIDATION_ERROR, 400, 'Validation failed'),
  entry(ErrorCode.VALIDATION_REQUIRED_FIELD, 400, '{{field}} is required'),
  entry(ErrorCode.VALIDATION_MISSING_REQUIRED, 400, 'Required field is missing'),
  entry(ErrorCode.VALIDATION_INVALID_FORMAT, 400, '{{field}} has invalid format'),
  entry(ErrorCode.VALIDATION_OUT_OF_RANGE, 400, '{{field}} is out of range'),
  entry(ErrorCode.VALIDATION_PROGRESS_OUT_OF_RANGE, 400, 'Progress must be a number between 0 and 100'),
  entry(ErrorCode.VALIDATION_INVALID_TIMEFRAME, 400, 'Invalid timeframe. Must be one of: week, month, quarter, year, all'),
  entry(ErrorCode.VALIDATION_MISSING_QUERY_PARAMS, 400, 'Missing required query parameters'),
  entry(ErrorCode.VALIDATION_MISSING_OAUTH_STATE, 400, 'Missing OAuth code or state'),
  entry(ErrorCode.VALIDATION_INVALID_OAUTH_STATE, 400, 'Invalid OAuth state format'),

  // ─── OAuth / Integrations ───────────────────────────────────────────────────
  entry(ErrorCode.OAUTH_GOOGLE_ERROR, 400, 'Google OAuth authorization failed'),
  entry(ErrorCode.OAUTH_CSRF_TOKEN_INVALID, 403, 'Invalid or expired CSRF token'),
  entry(ErrorCode.INTEGRATION_JOB_NOT_FOUND, 404, 'Job not found'),
  entry(ErrorCode.ZAPIER_SCOPE_MISSING, 403, 'API key missing required scope'),

  // ─── Uploads / Attachments ──────────────────────────────────────────────────
  entry(ErrorCode.UPLOAD_FAILED, 400, 'File upload failed'),
  entry(ErrorCode.UPLOAD_FILE_TOO_LARGE, 413, 'File too large'),
  entry(ErrorCode.UPLOAD_INVALID_TYPE, 400, 'Invalid file type'),
  entry(ErrorCode.UPLOAD_QUOTA_EXCEEDED, 429, 'Daily upload quota exceeded'),

  // ─── Rate limiting ──────────────────────────────────────────────────────────
  entry(ErrorCode.RATE_LIMIT_EXCEEDED, 429, 'You have exceeded the rate limit'),

  // ─── Infrastructure / Generic ───────────────────────────────────────────────
  entry(ErrorCode.BAD_REQUEST, 400, 'Bad request'),
  entry(ErrorCode.NOT_FOUND, 404, 'Resource not found'),
  entry(ErrorCode.CONFLICT, 409, 'Resource conflict'),
  entry(ErrorCode.INTERNAL_SERVER_ERROR, 500, 'Internal server error'),
  entry(ErrorCode.INTERNAL_ERROR, 500, 'Internal error'),
  entry(ErrorCode.SERVICE_UNAVAILABLE, 503, 'Service temporarily unavailable'),
  entry(ErrorCode.CIRCUIT_BREAKER_OPEN, 503, 'Database circuit breaker is open'),
  entry(ErrorCode.DATABASE_CONNECTION_FAILED, 503, 'Database connection failed'),
  entry(ErrorCode.DATABASE_QUERY_TIMEOUT, 504, 'Database query timed out'),
  entry(ErrorCode.DATABASE_UNIQUE_VIOLATION, 409, 'A record with these details already exists'),
  entry(ErrorCode.DATABASE_FOREIGN_KEY_VIOLATION, 400, 'Referenced record does not exist'),
  entry(ErrorCode.RESOURCE_NOT_FOUND, 404, 'Resource not found'),
  entry(ErrorCode.DUPLICATE_REQUEST, 409, 'Duplicate request'),
  entry(ErrorCode.MAINTENANCE_MODE, 503, 'System under maintenance'),

  // ─── Learning Paths ─────────────────────────────────────────────────────────
  entry(ErrorCode.LEARNING_PATH_NOT_FOUND, 404, 'Learning path not found'),
  entry(ErrorCode.LEARNING_PATH_NOT_PUBLISHED, 400, 'Learning path is not published'),
  entry(ErrorCode.LEARNING_PATH_ALREADY_PUBLISHED, 400, 'Learning path is already published'),
  entry(ErrorCode.LEARNING_PATH_HAS_ACTIVE_ENROLLMENTS, 400, 'Cannot modify learning path with active enrollments'),
  entry(ErrorCode.LEARNING_PATH_NO_MILESTONES, 400, 'Learning path must have at least one milestone to publish'),
  entry(ErrorCode.LEARNING_PATH_CLONING_NOT_ALLOWED, 400, 'Path is not available for cloning'),
  entry(ErrorCode.LEARNING_PATH_TEMPLATE_NOT_FOUND, 404, 'Template path not found'),
  entry(ErrorCode.LEARNING_PATH_UPDATE_FAILED, 500, 'Failed to update learning path'),
  entry(ErrorCode.LEARNING_PATH_DELETE_FAILED, 500, 'Failed to delete learning path'),
  entry(ErrorCode.LEARNING_PATH_PUBLISH_FAILED, 500, 'Failed to publish learning path'),
  entry(ErrorCode.LEARNING_PATH_UNPUBLISH_FAILED, 500, 'Failed to unpublish learning path'),
  entry(ErrorCode.LEARNING_PATH_NOT_ENROLLED, 403, 'Not enrolled in this learning path'),
  entry(ErrorCode.LEARNING_PATH_NOT_COMPLETED, 404, 'Learning path not completed or enrollment not found'),
  entry(ErrorCode.LEARNING_PATH_INVALID_STATUS, 400, 'Invalid learning path status'),
  entry(ErrorCode.PATH_ID_REQUIRED, 400, 'Path ID is required'),
  entry(ErrorCode.MILESTONE_ID_REQUIRED, 400, 'Milestone ID is required'),

  // ─── Enrollment ─────────────────────────────────────────────────────────────
  entry(ErrorCode.ENROLLMENT_NOT_FOUND, 404, 'Enrollment not found'),
  entry(ErrorCode.ENROLLMENT_ALREADY_EXISTS, 409, 'Student is already enrolled in this learning path'),
  entry(ErrorCode.ENROLLMENT_ALREADY_UNENROLLED, 400, 'Student is already unenrolled'),
  entry(ErrorCode.ENROLLMENT_STATUS_TRANSITION_INVALID, 400, 'Enrollment status transition is not allowed'),
  entry(ErrorCode.ENROLLMENT_UPDATE_FAILED, 500, 'Failed to update enrollment status'),
  entry(ErrorCode.ENROLLMENT_INACTIVE, 400, 'Cannot complete milestone for inactive enrollment'),
  entry(ErrorCode.STUDENT_NOT_FOUND, 404, 'Student not found'),
  entry(ErrorCode.STUDENT_ACCOUNT_INACTIVE, 403, 'Student account is not active'),
  entry(ErrorCode.ENROLLMENT_ACCESS_DENIED, 403, 'Access denied to this enrollment'),

  // ─── Milestones ─────────────────────────────────────────────────────────────
  entry(ErrorCode.MILESTONE_NOT_FOUND, 404, 'Milestone not found'),
  entry(ErrorCode.MILESTONE_ALREADY_COMPLETED, 400, 'Milestone is already completed'),
  entry(ErrorCode.MILESTONE_COMPLETION_FAILED, 500, 'Failed to complete milestone'),
  entry(ErrorCode.MILESTONE_PREREQUISITES_NOT_MET, 403, 'Prerequisites not met for this milestone'),
  entry(ErrorCode.MILESTONE_STEP_PREREQUISITES_NOT_MET, 422, 'Step prerequisites not met'),
  entry(ErrorCode.MILESTONE_STEP_INVALID, 400, 'Invalid step ID'),
  entry(ErrorCode.MILESTONE_ACCESS_DENIED, 403, 'Access denied to this milestone'),
  entry(ErrorCode.MILESTONE_COMPLETION_CRITERIA_NOT_MET, 400, 'Completion criteria not met'),
  entry(ErrorCode.MILESTONE_SKIP_REQUIRES_MENTOR_APPROVAL, 400, 'Cannot skip required milestone without mentor approval'),
  entry(ErrorCode.PREREQUISITE_NOT_FOUND, 404, 'Prerequisite not found'),
  entry(ErrorCode.PREREQUISITE_OVERRIDE_NOT_FOUND, 404, 'Override not found'),
  entry(ErrorCode.PREREQUISITE_OVERRIDE_EXISTS, 409, 'Override already exists for this prerequisite'),
  entry(ErrorCode.PREREQUISITE_OVERRIDE_PERMISSION_DENIED, 403, 'Only the mentor can manage prerequisite overrides'),

  // ─── Certifications / Certificates ──────────────────────────────────────────
  entry(ErrorCode.CERTIFICATION_TYPE_NOT_FOUND, 404, 'Certification type not found'),
  entry(ErrorCode.CERTIFICATION_NOT_FOUND, 404, 'Certification not found'),
  entry(ErrorCode.CERTIFICATION_ALREADY_EXISTS, 409, 'Certification already exists for this mentor'),
  entry(ErrorCode.CERTIFICATE_NOT_FOUND, 404, 'Certificate not found'),
  entry(ErrorCode.CERTIFICATE_ALREADY_EXISTS, 409, 'Certificate already exists'),
  entry(ErrorCode.CERTIFICATE_REVOKE_PERMISSION_DENIED, 403, 'Insufficient permissions to revoke certificate'),
  entry(ErrorCode.CERTIFICATE_MILESTONES_INCOMPLETE, 400, 'All milestones must be completed before generating certificate'),

  // ─── Reviews ────────────────────────────────────────────────────────────────
  entry(ErrorCode.REVIEW_NOT_FOUND, 404, 'Review not found'),
  entry(ErrorCode.REVIEW_ALREADY_EXISTS, 409, 'Review already exists'),
  entry(ErrorCode.REVIEW_VOTE_DUPLICATE, 409, 'You have already voted on this review'),
  entry(ErrorCode.REVIEW_FLAG_DUPLICATE, 409, 'You have already flagged this review'),
  entry(ErrorCode.REVIEW_SELF_INTERACTION_FORBIDDEN, 403, 'You cannot interact with your own review'),
  entry(ErrorCode.REVIEW_RESPONSE_NOT_FOUND, 404, 'Review response not found'),
  entry(ErrorCode.REVIEW_RESPONSE_CREATE_FAILED, 500, 'Failed to create review response'),
  entry(ErrorCode.REVIEW_EDIT_FORBIDDEN, 403, 'You are not authorized to edit this review'),
  entry(ErrorCode.REVIEW_DELETE_FORBIDDEN, 403, 'You are not authorized to delete this review'),
  entry(ErrorCode.SELF_REVIEW_FORBIDDEN, 403, 'Cannot review your own submission'),

  // ─── Study Groups / Forums ──────────────────────────────────────────────────
  entry(ErrorCode.STUDY_GROUP_NOT_FOUND, 404, 'Study group not found or access denied'),
  entry(ErrorCode.STUDY_GROUP_FULL, 400, 'Study group is full'),
  entry(ErrorCode.STUDY_GROUP_MEMBER_EXISTS, 409, 'User is already a member of this study group'),
  entry(ErrorCode.STUDY_GROUP_ENROLLMENT_REQUIRED, 403, 'Must be enrolled in the learning path to join study group'),
  entry(ErrorCode.FORUM_NOT_FOUND, 404, 'Forum not found or access denied'),
  entry(ErrorCode.FORUM_ALREADY_EXISTS, 409, 'Forum already exists for this milestone'),
  entry(ErrorCode.FORUM_POST_DENIED, 403, 'Access denied to post in this forum'),

  // ─── Payments (learning-path purchases, etc.) ───────────────────────────────
  entry(ErrorCode.PAYMENT_REFERENCE_ALREADY_USED, 409, 'Payment reference has already been used'),
  entry(ErrorCode.PAYMENT_INSUFFICIENT_AMOUNT, 402, 'Payment amount is insufficient'),
  entry(ErrorCode.PAYMENT_CURRENCY_MISMATCH, 402, 'Payment currency does not match expected currency'),
  entry(ErrorCode.PAYMENT_REQUIRED, 402, 'Payment required'),
  entry(ErrorCode.PAYMENT_UNSUCCESSFUL, 402, 'Payment has not succeeded'),

  // ─── Referrals / Affiliates ─────────────────────────────────────────────────
  entry(ErrorCode.REFERRAL_NOT_FOUND, 404, 'Referral not found'),
  entry(ErrorCode.REFERRAL_CODE_REQUIRED, 400, 'Referral code is required'),
  entry(ErrorCode.REFERRAL_CODE_INVALID, 400, 'Invalid or expired referral code'),
  entry(ErrorCode.REFERRAL_CODE_GENERATION_FAILED, 500, 'Failed to generate unique referral code'),
  entry(ErrorCode.REFERRAL_CODE_ALREADY_ACTIVE, 409, 'User already has an active referral code'),
  entry(ErrorCode.AFFILIATE_PROFILE_NOT_FOUND, 404, 'Affiliate profile not found'),
  entry(ErrorCode.AFFILIATE_PROFILE_EXISTS, 409, 'Affiliate profile already exists'),

  // ─── API Keys / Integrations ────────────────────────────────────────────────
  entry(ErrorCode.API_KEY_NOT_FOUND, 404, 'API key not found or not owned by user'),

  // ─── Onboarding ─────────────────────────────────────────────────────────────
  entry(ErrorCode.ONBOARDING_NOT_FOUND, 404, 'Onboarding not found'),
  entry(ErrorCode.ONBOARDING_ALREADY_COMPLETED, 400, 'Onboarding already completed'),
  entry(ErrorCode.ONBOARDING_NOT_PAUSED, 400, 'Onboarding is not paused'),
  entry(ErrorCode.ONBOARDING_RATE_LIMITED, 429, 'Too many onboarding completion attempts. Please try again later.'),
  entry(ErrorCode.ONBOARDING_STEP_INVALID, 400, 'Invalid step ID'),
  entry(ErrorCode.ONBOARDING_STEP_ALREADY_COMPLETED, 400, 'Step already completed'),
  entry(ErrorCode.ONBOARDING_STEP_PREREQUISITES_NOT_MET, 422, 'Step prerequisites not met'),
  entry(ErrorCode.CHECKLIST_ITEM_NOT_FOUND, 404, 'Checklist item not found'),

  // ─── Skill Tests ────────────────────────────────────────────────────────────
  entry(ErrorCode.SKILL_TEST_NOT_FOUND, 404, 'Skill test not found'),
  entry(ErrorCode.TEST_ATTEMPT_NOT_FOUND, 404, 'Test attempt not found'),
  entry(ErrorCode.TEST_ATTEMPT_IN_PROGRESS, 409, 'Test attempt already in progress'),
  entry(ErrorCode.TEST_ATTEMPT_NOT_IN_PROGRESS, 400, 'Test attempt is not in progress'),
  entry(ErrorCode.TEST_ANSWERS_REQUIRED, 400, 'Answers are required'),

  // ─── Sessions / Outcomes ────────────────────────────────────────────────────
  entry(ErrorCode.SESSION_NOT_FOUND, 404, 'Session not found'),
  entry(ErrorCode.SESSION_OUTCOME_NOT_FOUND, 404, 'Session outcome not found'),
  entry(ErrorCode.SESSION_OUTCOME_INVALID_STATE, 400, 'Can only create outcomes for completed sessions'),
  entry(ErrorCode.SESSION_MILESTONE_LINK_MISSING, 404, 'Session is not linked to any milestone'),
  entry(ErrorCode.SESSION_MILESTONE_ALREADY_LINKED, 409, 'Session is already linked to a milestone'),
  entry(ErrorCode.SESSION_NOT_AUTHORIZED, 403, 'Not authorized for this session'),

  // ─── Session Templates ─────────────────────────────────────────────────────
  entry(ErrorCode.SESSION_TEMPLATE_NOT_FOUND, 404, 'Session template not found'),
  entry(ErrorCode.SESSION_TEMPLATE_UPDATE_FAILED, 500, 'Failed to update session template'),
  entry(ErrorCode.SESSION_TEMPLATE_DELETE_FAILED, 500, 'Failed to delete session template'),
  entry(ErrorCode.SESSION_TEMPLATE_HAS_USAGE, 400, 'Cannot delete template with existing usage'),
  entry(ErrorCode.SESSION_TEMPLATE_CREATION_FAILED, 500, 'Failed to create session template'),
  entry(ErrorCode.SESSION_TEMPLATE_CLONE_FAILED, 500, 'Failed to clone session template'),

  // ─── Session Quality ───────────────────────────────────────────────────────
  entry(ErrorCode.SESSION_QUALITY_ASSESSMENT_FAILED, 500, 'Failed to assess session quality'),
  entry(ErrorCode.SESSION_QUALITY_NOT_FOUND, 404, 'Session quality assessment not found'),
  entry(ErrorCode.SESSION_QUALITY_INVALID_INPUT, 400, 'Invalid input for quality assessment'),

  // ─── Dispute Resolution ────────────────────────────────────────────────────
  entry(ErrorCode.DISPUTE_EVIDENCE_UPLOAD_FAILED, 500, 'Failed to upload dispute evidence'),
  entry(ErrorCode.DISPUTE_EVIDENCE_NOT_FOUND, 404, 'Dispute evidence not found'),
  entry(ErrorCode.DISPUTE_MEDIATION_FAILED, 500, 'Failed to initiate mediation'),
  entry(ErrorCode.DISPUTE_RESOLUTION_FAILED, 500, 'Failed to resolve dispute'),
  entry(ErrorCode.DISPUTE_ALREADY_RESOLVED, 409, 'Dispute has already been resolved'),
  entry(ErrorCode.DISPUTE_EVIDENCE_LIMIT_EXCEEDED, 400, 'Evidence limit exceeded for this dispute'),

  // ─── Internationalization ───────────────────────────────────────────────────
  entry(ErrorCode.I18N_TRANSLATION_NOT_FOUND, 404, 'Translation not found'),
  entry(ErrorCode.I18N_LANGUAGE_NOT_SUPPORTED, 400, 'Language not supported'),
  entry(ErrorCode.I18N_TRANSLATION_UPDATE_FAILED, 500, 'Failed to update translation'),
  entry(ErrorCode.I18N_RTL_SUPPORT_ERROR, 500, 'RTL language support error'),

  // ─── Background Checks ──────────────────────────────────────────────────────
  entry(ErrorCode.BACKGROUND_CHECK_NOT_FOUND, 404, 'Background check not found'),
  entry(ErrorCode.BACKGROUND_CHECK_ALREADY_IN_PROGRESS, 409, 'Background check already in progress'),
  entry(ErrorCode.BACKGROUND_CHECK_SIMULATION_DISABLED, 500, 'Simulated background checks are disabled in production'),
  entry(ErrorCode.BACKGROUND_CHECK_INPUT_REQUIRED, 400, 'Check type and provider are required'),

  // ─── Bulk / CSV ─────────────────────────────────────────────────────────────
  entry(ErrorCode.BULK_CSV_VALIDATION_FAILED, 400, 'CSV validation failed'),
  entry(ErrorCode.BULK_CSV_COLUMN_MISSING, 400, 'CSV missing required column: {{column}}'),

  // ─── Oracle / iCal / MFA / Misc domain ──────────────────────────────────────
  entry(ErrorCode.ORACLE_NOT_CONFIGURED, 503, 'Oracle contract is not configured'),
  entry(ErrorCode.ICAL_TOKEN_INVALID, 404, 'Invalid or expired calendar token'),
  entry(ErrorCode.ICAL_RATE_LIMIT_EXCEEDED, 429, 'Rate limit exceeded for calendar feed'),
  entry(ErrorCode.MFA_PHONE_NUMBER_REQUIRED, 400, 'Phone number required for SMS MFA'),
  entry(ErrorCode.INVALID_CURSOR, 400, 'Invalid pagination cursor'),
  entry(ErrorCode.ASSET_UNSUPPORTED, 400, 'Unsupported asset'),
  entry(ErrorCode.ASSET_INVALID_SEND_AMOUNT, 400, 'Invalid send amount'),
  entry(ErrorCode.QUOTE_EXPIRED_OR_NOT_FOUND, 400, 'Quote expired or not found'),
  entry(ErrorCode.QUOTE_EXPIRED, 400, 'Quote has expired'),
  entry(ErrorCode.QUOTE_RATE_MOVED, 409, 'Rate moved beyond acceptable range since quote'),
  entry(ErrorCode.SDEX_LIQUIDITY_UNAVAILABLE, 503, 'No liquidity found on SDEX for the requested pair'),
  entry(ErrorCode.PAYOUT_MINIMUM_NOT_MET, 400, 'Minimum payout amount not met'),
  entry(ErrorCode.GOAL_NOT_FOUND, 404, 'Goal not found'),
  entry(ErrorCode.GOAL_UPDATE_FAILED, 500, 'Failed to update goal'),
  entry(ErrorCode.WEBHOOK_PAYLOAD_INVALID, 400, 'Webhook payload missing provider reference'),
  entry(ErrorCode.SUBMISSION_NOT_FOUND, 404, 'Submission not found'),
  entry(ErrorCode.SUBMISSION_ANSWERS_REQUIRED, 400, 'Response text is required'),
]) as Record<ErrorCode, ErrorCatalogEntry>;

/** All error codes as a readonly string union type (SDK-friendly). */
export const ERROR_CODES = Object.values(ErrorCode) as ErrorCode[];
export type ErrorCodeValue = `${ErrorCode}`;

/** Typed list shape returned by GET /api/v1/errors/catalog. */
export interface ErrorCatalogResponse {
  count: number;
  catalog: Array<{
    code: string;
    message: string;
    httpStatus: number;
    i18nKey: string;
  }>;
}

/** Returns the catalog entry for a code (falls back to 500/generic). */
export function getCatalogEntry(code: string): ErrorCatalogEntry {
  return (
    ERROR_CATALOG[code as ErrorCode] ?? {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      httpStatus: 500,
      message: 'Internal server error',
      i18nKey: `codes.${ErrorCode.INTERNAL_SERVER_ERROR}`,
    }
  );
}
