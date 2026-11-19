/**
 * Mentor Onboarding Integration Tests (issue #1050)
 *
 * Integration tests verifying the full mentor onboarding flow:
 * 1. Submit profile
 * 2. Upload verification documents
 * 3. Pass background check
 * 4. Get certified
 *
 * Run via: npm run test:mentor-onboarding-integration
 */

import pool from "../../config/database";
import { MentorOnboardingService } from "../mentor-onboarding.service";
import { BackgroundCheckService } from "../background-check.service";
import { VerificationService } from "../verification.service";
import { createError } from "../../middleware/errorHandler";
import { ErrorCode } from "../../errors/error-codes";

const TEST_MENTOR_ID = "test-mentor-" + Date.now();

async function setupTestMentor(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [TEST_MENTOR_ID, `mentor-${Date.now()}@test.com`, "Test", "Mentor", "mentor"]
  );
  return rows[0]?.id || TEST_MENTOR_ID;
}

async function cleanupTestMentor(mentorId: string): Promise<void> {
  await pool.query(
    `DELETE FROM mentor_onboarding WHERE mentor_id = $1`,
    [mentorId]
  );
  await pool.query(
    `DELETE FROM users WHERE id = $1`,
    [mentorId]
  );
}

async function testProfileSubmission(mentorId: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET bio = $1, expertise = $2, education = $3, avatar_url = $4
     WHERE id = $5`,
    [
      "I am a senior software engineer with 10 years of experience",
      JSON.stringify(["JavaScript", "React", "Node.js"]),
      JSON.stringify({
        degree: "BS Computer Science",
        school: "MIT"
      }),
      "https://example.com/avatar.jpg",
      mentorId
    ]
  );
}

async function testDocumentUpload(mentorId: string): Promise<void> {
  await pool.query(
    `INSERT INTO mentor_verifications (mentor_id, document_type, document_url, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mentor_id) DO UPDATE SET
       document_url = EXCLUDED.document_url,
       status = EXCLUDED.status`,
    [
      mentorId,
      "government_id",
      "https://example.com/documents/id.pdf",
      "approved"
    ]
  );
}

async function testBackgroundCheck(mentorId: string): Promise<void> {
  await pool.query(
    `INSERT INTO mentor_background_checks (mentor_id, check_type, status, result, checked_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (mentor_id, check_type) DO UPDATE SET
       status = EXCLUDED.status,
       result = EXCLUDED.result,
       checked_at = CURRENT_TIMESTAMP`,
    [mentorId, "criminal", "completed", "clear"]
  );
}

async function testCertification(mentorId: string): Promise<void> {
  await pool.query(
    `INSERT INTO mentor_certifications (mentor_id, title, issuer, issue_date, expiry_date, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      mentorId,
      "AWS Certified Solutions Architect",
      "Amazon Web Services",
      new Date(),
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      "verified"
    ]
  );
}

export const mentorOnboardingTests = {
  async runAllTests(): Promise<{
    passed: number;
    failed: number;
    tests: { name: string; passed: boolean; error?: string }[];
  }> {
    const tests: { name: string; passed: boolean; error?: string }[] = [];
    let passed = 0;
    let failed = 0;

    const mentorId = await setupTestMentor();

    try {
      // Test 1: Initialize onboarding
      try {
        const onboarding = await MentorOnboardingService.initializeOnboarding(mentorId);
        if (onboarding && onboarding.status === "in_progress") {
          tests.push({ name: "Initialize onboarding", passed: true });
          passed++;
        } else {
          throw new Error("Onboarding not initialized");
        }
      } catch (error) {
        tests.push({
          name: "Initialize onboarding",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 2: Complete profile setup
      try {
        await testProfileSubmission(mentorId);
        const onboarding = await MentorOnboardingService.completeStep(mentorId, "profile_setup");
        if (onboarding && onboarding.stepsCompleted.includes("profile_setup")) {
          tests.push({ name: "Complete profile setup", passed: true });
          passed++;
        } else {
          throw new Error("Profile setup not completed");
        }
      } catch (error) {
        tests.push({
          name: "Complete profile setup",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 3: Complete identity verification
      try {
        await testDocumentUpload(mentorId);
        const onboarding = await MentorOnboardingService.completeStep(mentorId, "identity_verification");
        if (onboarding && onboarding.stepsCompleted.includes("identity_verification")) {
          tests.push({ name: "Complete identity verification", passed: true });
          passed++;
        } else {
          throw new Error("Identity verification not completed");
        }
      } catch (error) {
        tests.push({
          name: "Complete identity verification",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 4: Complete background check
      try {
        await testBackgroundCheck(mentorId);
        const onboarding = await MentorOnboardingService.completeStep(mentorId, "background_check");
        if (onboarding && onboarding.stepsCompleted.includes("background_check")) {
          tests.push({ name: "Complete background check", passed: true });
          passed++;
        } else {
          throw new Error("Background check not completed");
        }
      } catch (error) {
        tests.push({
          name: "Complete background check",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 5: Check onboarding progress
      try {
        const progress = await MentorOnboardingService.getOnboardingProgress(mentorId);
        if (progress && progress.stepsCompleted.length >= 3) {
          tests.push({ name: "Get onboarding progress", passed: true });
          passed++;
        } else {
          throw new Error("Progress not retrieved correctly");
        }
      } catch (error) {
        tests.push({
          name: "Get onboarding progress",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 6: Compute profile score
      try {
        const score = await MentorOnboardingService.computeProfileScore(mentorId);
        if (score && score.totalScore > 0) {
          tests.push({ name: "Compute profile score", passed: true });
          passed++;
        } else {
          throw new Error("Profile score not computed");
        }
      } catch (error) {
        tests.push({
          name: "Compute profile score",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 7: Track analytics
      try {
        await MentorOnboardingService.trackAnalytics(mentorId, "step_complete", "profile_setup", {
          timestamp: new Date(),
        });
        const analytics = await MentorOnboardingService.getOnboardingAnalytics(mentorId);
        if (analytics && analytics.events) {
          tests.push({ name: "Track onboarding analytics", passed: true });
          passed++;
        } else {
          throw new Error("Analytics not tracked");
        }
      } catch (error) {
        tests.push({
          name: "Track onboarding analytics",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 8: Initialize success checklist
      try {
        await MentorOnboardingService.initializeSuccessChecklist(mentorId);
        const checklist = await MentorOnboardingService.getSuccessChecklist(mentorId);
        if (checklist && checklist.length > 0) {
          tests.push({ name: "Initialize success checklist", passed: true });
          passed++;
        } else {
          throw new Error("Checklist not initialized");
        }
      } catch (error) {
        tests.push({
          name: "Initialize success checklist",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 9: Get wizard steps
      try {
        const steps = await MentorOnboardingService.getWizardSteps();
        if (steps && Array.isArray(steps)) {
          tests.push({ name: "Get wizard steps", passed: true });
          passed++;
        } else {
          throw new Error("Wizard steps not retrieved");
        }
      } catch (error) {
        tests.push({
          name: "Get wizard steps",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

      // Test 10: Pause and resume onboarding
      try {
        await MentorOnboardingService.pauseOnboarding(mentorId, "Testing pause");
        let onboarding = await MentorOnboardingService.getOnboarding(mentorId);
        if (onboarding && onboarding.status === "on_hold") {
          await MentorOnboardingService.resumeOnboarding(mentorId);
          onboarding = await MentorOnboardingService.getOnboarding(mentorId);
          if (onboarding && onboarding.status === "in_progress") {
            tests.push({ name: "Pause and resume onboarding", passed: true });
            passed++;
          } else {
            throw new Error("Onboarding not resumed");
          }
        } else {
          throw new Error("Onboarding not paused");
        }
      } catch (error) {
        tests.push({
          name: "Pause and resume onboarding",
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }

    } finally {
      await cleanupTestMentor(mentorId);
    }

    return { passed, failed, tests };
  },
};
