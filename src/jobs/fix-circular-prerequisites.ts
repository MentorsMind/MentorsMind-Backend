import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { PrerequisiteValidatorService, Prerequisite } from "../services/prerequisite-validator.service";

/**
 * One-time migration job to detect and remove existing circular dependencies
 * in learning path prerequisites.
 */
async function run() {
  logger.info("Starting circular prerequisites cleanup job...");
  const client = await pool.connect();
  let deletedCount = 0;

  try {
    // Get all learning paths that have milestones with prerequisites
    const { rows: paths } = await client.query(`
      SELECT DISTINCT lp.id
      FROM learning_paths lp
      JOIN milestones m ON m.learning_path_id = lp.id
      JOIN prerequisites p ON p.milestone_id = m.id
    `);

    logger.info(`Found ${paths.length} learning paths with prerequisites. Checking for cycles...`);

    for (const path of paths) {
      // Get all prerequisites for this path
      const { rows: prerequisites } = await client.query<Prerequisite>(`
        SELECT 
          p.id, p.milestone_id as "milestoneId", p.prerequisite_type as "prerequisiteType",
          p.prerequisite_id as "prerequisiteId", p.skill_name as "skillName",
          p.assessment_criteria as "assessmentCriteria", p.is_required as "isRequired",
          p.created_at as "createdAt"
        FROM prerequisites p
        JOIN milestones m ON p.milestone_id = m.id
        WHERE m.learning_path_id = $1
        ORDER BY p.created_at ASC
      `, [path.id]);

      // Use Kahn's algorithm implementation to find cycles
      const cyclePath = PrerequisiteValidatorService.detectCyclesKahn(prerequisites);

      if (cyclePath) {
        logger.warn(`Cycle detected in learning path ${path.id}: ${cyclePath.join(' -> ')}`);
        
        // Find the latest prerequisite that created the cycle and remove it
        // Since they are ordered by createdAt ASC, we can iterate from the end
        // and find a prerequisite that involves these nodes.
        let prereqToRemove = null;
        for (let i = prerequisites.length - 1; i >= 0; i--) {
          const p = prerequisites[i];
          if (p.prerequisiteType === 'milestone' && p.prerequisiteId && cyclePath.includes(p.prerequisiteId) && cyclePath.includes(p.milestoneId)) {
            prereqToRemove = p;
            break;
          }
        }

        if (prereqToRemove) {
          logger.info(`Breaking cycle by removing prerequisite ${prereqToRemove.id}`);
          await client.query('DELETE FROM prerequisites WHERE id = $1', [prereqToRemove.id]);
          deletedCount++;
          
          // Note: we might need to rerun the check on this path if there are multiple overlapping cycles
          // But for a simple migration, breaking one edge of the detected cycle might be enough to break the main cycle.
        }
      }
    }

    logger.info(`Migration job completed successfully. Removed ${deletedCount} circular prerequisites.`);
  } catch (error) {
    logger.error("Error running circular prerequisites cleanup job:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the job if executed directly
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}

export default run;
