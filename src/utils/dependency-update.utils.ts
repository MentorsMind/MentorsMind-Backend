/**
 * Dependency Update Utility
 * 
 * Handles dependency update tracking, validation, and changelog management.
 * Works with Dependabot for automated dependency updates.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logInfo, logWarning, logError } from './error.utils';

export interface DependencyUpdate {
  name: string;
  oldVersion: string;
  newVersion: string;
  type: 'production' | 'development';
  updateType: 'patch' | 'minor' | 'major';
  security: boolean;
  breakingChanges: string[];
  date: Date;
  status: 'pending' | 'tested' | 'deployed' | 'failed';
}

export interface ChangelogEntry {
  date: Date;
  version: string;
  updates: DependencyUpdate[];
  breakingChanges: string[];
  notes: string;
}

class DependencyUpdateManager {
  private updateHistory: DependencyUpdate[] = [];
  private changelog: ChangelogEntry[] = [];
  private readonly MAX_HISTORY = 200;
  private readonly CHANGELOG_PATH = join(process.cwd(), 'CHANGELOG.md');
  private readonly UPDATES_LOG_PATH = join(process.cwd(), '.dependency-updates.json');

  /**
   * Parse package.json to get current dependencies
   */
  private getCurrentDependencies(): Record<string, string> {
    try {
      const packageJsonPath = join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
    } catch (error) {
      logWarning('Failed to read package.json', {
        error: (error as Error).message,
      });
      return {};
    }
  }

  /**
   * Determine update type (patch, minor, major)
   */
  private getUpdateType(oldVersion: string, newVersion: string): 'patch' | 'minor' | 'major' {
    const oldParts = oldVersion.replace(/^[^0-9]+/, '').split('.');
    const newParts = newVersion.replace(/^[^0-9]+/, '').split('.');

    const oldMajor = parseInt(oldParts[0] || '0');
    const oldMinor = parseInt(oldParts[1] || '0');
    const oldPatch = parseInt(oldParts[2] || '0');

    const newMajor = parseInt(newParts[0] || '0');
    const newMinor = parseInt(newParts[1] || '0');
    const newPatch = parseInt(newParts[2] || '0');

    if (newMajor > oldMajor) return 'major';
    if (newMinor > oldMinor) return 'minor';
    return 'patch';
  }

  /**
   * Record a dependency update
   */
  recordUpdate(
    name: string,
    oldVersion: string,
    newVersion: string,
    type: 'production' | 'development',
    security: boolean = false,
    breakingChanges: string[] = []
  ): DependencyUpdate {
    const updateType = this.getUpdateType(oldVersion, newVersion);

    const update: DependencyUpdate = {
      name,
      oldVersion,
      newVersion,
      type,
      updateType,
      security,
      breakingChanges,
      date: new Date(),
      status: 'pending',
    };

    this.updateHistory.push(update);

    // Keep only recent history
    if (this.updateHistory.length > this.MAX_HISTORY) {
      this.updateHistory = this.updateHistory.slice(-this.MAX_HISTORY);
    }

    logInfo(`Dependency update recorded: ${name} ${oldVersion} → ${newVersion}`, {
      type,
      updateType,
      security,
      breakingChanges: breakingChanges.length,
    });

    return update;
  }

  /**
   * Mark update as tested
   */
  markAsTested(name: string, version: string): void {
    const update = this.updateHistory.find((u) => u.name === name && u.newVersion === version);
    if (update) {
      update.status = 'tested';
      logInfo(`Update marked as tested: ${name} ${version}`);
    }
  }

  /**
   * Mark update as deployed
   */
  markAsDeployed(name: string, version: string): void {
    const update = this.updateHistory.find((u) => u.name === name && u.newVersion === version);
    if (update) {
      update.status = 'deployed';
      logInfo(`Update marked as deployed: ${name} ${version}`);
    }
  }

  /**
   * Mark update as failed
   */
  markAsFailed(name: string, version: string, reason: string): void {
    const update = this.updateHistory.find((u) => u.name === name && u.newVersion === version);
    if (update) {
      update.status = 'failed';
      logWarning(`Update marked as failed: ${name} ${version}`, {
        reason,
      });
    }
  }

  /**
   * Get updates by type
   */
  getUpdatesByType(type: 'patch' | 'minor' | 'major'): DependencyUpdate[] {
    return this.updateHistory.filter((u) => u.updateType === type);
  }

  /**
   * Get security updates
   */
  getSecurityUpdates(): DependencyUpdate[] {
    return this.updateHistory.filter((u) => u.security);
  }

  /**
   * Get updates with breaking changes
   */
  getBreakingChanges(): DependencyUpdate[] {
    return this.updateHistory.filter((u) => u.breakingChanges.length > 0);
  }

  /**
   * Get update statistics
   */
  getUpdateStats() {
    const total = this.updateHistory.length;
    const byType = {
      patch: this.getUpdatesByType('patch').length,
      minor: this.getUpdatesByType('minor').length,
      major: this.getUpdatesByType('major').length,
    };
    const byStatus = {
      pending: this.updateHistory.filter((u) => u.status === 'pending').length,
      tested: this.updateHistory.filter((u) => u.status === 'tested').length,
      deployed: this.updateHistory.filter((u) => u.status === 'deployed').length,
      failed: this.updateHistory.filter((u) => u.status === 'failed').length,
    };
    const security = this.getSecurityUpdates().length;
    const breaking = this.getBreakingChanges().length;

    return {
      total,
      byType,
      byStatus,
      security,
      breaking,
      lastUpdate: this.updateHistory[this.updateHistory.length - 1],
    };
  }

  /**
   * Add changelog entry
   */
  addChangelogEntry(
    version: string,
    updates: DependencyUpdate[],
    breakingChanges: string[] = [],
    notes: string = ''
  ): ChangelogEntry {
    const entry: ChangelogEntry = {
      date: new Date(),
      version,
      updates,
      breakingChanges,
      notes,
    };

    this.changelog.push(entry);
    this.saveChangelog();

    logInfo(`Changelog entry added for version ${version}`, {
      updates: updates.length,
      breakingChanges: breakingChanges.length,
    });

    return entry;
  }

  /**
   * Save changelog to file
   */
  private saveChangelog(): void {
    try {
      const content = this.generateChangelogContent();
      writeFileSync(this.CHANGELOG_PATH, content, 'utf-8');
      logInfo('Changelog saved successfully');
    } catch (error) {
      logError(error as Error, 'high', {
        operation: 'save_changelog',
      });
    }
  }

  /**
   * Generate changelog content
   */
  private generateChangelogContent(): string {
    let content = '# Changelog\n\n';
    content += 'All notable changes to this project will be documented in this file.\n\n';
    content += '## Format\n\n';
    content += 'This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.\n\n';

    for (const entry of this.changelog.reverse()) {
      content += `## [${entry.version}] - ${entry.date.toISOString().split('T')[0]}\n\n`;

      if (entry.breakingChanges.length > 0) {
        content += '### ⚠️ Breaking Changes\n\n';
        for (const change of entry.breakingChanges) {
          content += `- ${change}\n`;
        }
        content += '\n';
      }

      if (entry.updates.length > 0) {
        content += '### Dependencies Updated\n\n';

        const security = entry.updates.filter((u) => u.security);
        const major = entry.updates.filter((u) => u.updateType === 'major');
        const minor = entry.updates.filter((u) => u.updateType === 'minor');
        const patch = entry.updates.filter((u) => u.updateType === 'patch');

        if (security.length > 0) {
          content += '#### Security Updates\n\n';
          for (const update of security) {
            content += `- **${update.name}**: ${update.oldVersion} → ${update.newVersion}\n`;
          }
          content += '\n';
        }

        if (major.length > 0) {
          content += '#### Major Updates\n\n';
          for (const update of major) {
            content += `- **${update.name}**: ${update.oldVersion} → ${update.newVersion}`;
            if (update.breakingChanges.length > 0) {
              content += ` (Breaking changes: ${update.breakingChanges.join(', ')})`;
            }
            content += '\n';
          }
          content += '\n';
        }

        if (minor.length > 0) {
          content += '#### Minor Updates\n\n';
          for (const update of minor) {
            content += `- **${update.name}**: ${update.oldVersion} → ${update.newVersion}\n`;
          }
          content += '\n';
        }

        if (patch.length > 0) {
          content += '#### Patch Updates\n\n';
          for (const update of patch) {
            content += `- **${update.name}**: ${update.oldVersion} → ${update.newVersion}\n`;
          }
          content += '\n';
        }
      }

      if (entry.notes) {
        content += '### Notes\n\n';
        content += `${entry.notes}\n\n`;
      }
    }

    return content;
  }

  /**
   * Get changelog
   */
  getChangelog(limit: number = 10): ChangelogEntry[] {
    return this.changelog.slice(-limit);
  }

  /**
   * Get update history
   */
  getUpdateHistory(limit: number = 50): DependencyUpdate[] {
    return this.updateHistory.slice(-limit);
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.updateHistory = [];
    logInfo('Dependency update history cleared');
  }
}

export default new DependencyUpdateManager();
