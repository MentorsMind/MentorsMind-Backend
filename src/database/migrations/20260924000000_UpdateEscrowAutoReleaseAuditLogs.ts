import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateEscrowAutoReleaseAuditLogs20260924000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Escrow auto releases currently use 'system' as user_id and omit system_actor in metadata.
    // This migration fixes historical records so they have system_actor: 'auto_release'.
    await queryRunner.query(`
      UPDATE audit_logs
      SET metadata = jsonb_set(
        metadata,
        '{system_actor}',
        '"auto_release"'
      )
      WHERE user_id = 'system'
        AND action = 'ADMIN_ACTION'
        AND entity_type = 'escrow'
        AND message LIKE 'Escrow % auto-released after 48h';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert the migration by removing the system_actor key from metadata
    // for those specific logs.
    await queryRunner.query(`
      UPDATE audit_logs
      SET metadata = metadata - 'system_actor'
      WHERE user_id = 'system'
        AND action = 'ADMIN_ACTION'
        AND entity_type = 'escrow'
        AND message LIKE 'Escrow % auto-released after 48h';
    `);
  }
}
