import { promises as fs, existsSync } from 'fs';
import path from 'path';

const DATA_PATH = path.join(__dirname, '../../../data/datasets.json');

export interface BackupConfig {
  enabled: boolean;
  backupDir: string;
  maxBackups: number;
  cronSchedule: string;
}

export interface BackupMetadata {
  timestamp: string;
  filename: string;
  size: number;
  datasetsCount: number;
  transactionsCount: number;
}

/**
 * Service for managing automated database backups
 */
export class BackupService {
  private config: BackupConfig;

  constructor(config: BackupConfig) {
    this.config = config;
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    if (!existsSync(this.config.backupDir)) {
      await fs.mkdir(this.config.backupDir, { recursive: true });
      logger.info(`[Backup] Created backup directory: ${this.config.backupDir}`);
    }
  }

  /**
   * Create a backup of the current database state
   */
  async createBackup(): Promise<BackupMetadata> {
    try {
      await this.ensureBackupDirectory();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.json`;
      const backupPath = path.join(this.config.backupDir, filename);

      // Read raw bytes once — avoids the parse→object→stringify round-trip that
      // readStore() + JSON.stringify(backupData) would cause (peak ~3× file size).
      const rawData = existsSync(DATA_PATH)
        ? await fs.readFile(DATA_PATH, 'utf-8')
        : JSON.stringify({ datasets: [], transactions: [], webhooks: [] });

      // Parse once only to extract the two counts needed for metadata.
      const parsed = JSON.parse(rawData) as { datasets?: unknown[]; transactions?: unknown[] };
      const datasetsCount = parsed.datasets?.length ?? 0;
      const transactionsCount = parsed.transactions?.length ?? 0;
      const nowIso = new Date().toISOString();

      // Write backup in three sequential chunks: header + raw store bytes + closing brace.
      // This never materialises a second full JSON string in memory.
      const fh = await fs.open(backupPath, 'w');
      try {
        await fh.write(
          `{"metadata":${JSON.stringify({ timestamp: nowIso, version: '1.0.0', datasetsCount, transactionsCount })},"data":`,
        );
        await fh.write(rawData);
        await fh.write('}');
      } finally {
        await fh.close();
      }

      const stats = await fs.stat(backupPath);
      const metadata: BackupMetadata = {
        timestamp: nowIso,
        filename,
        size: stats.size,
        datasetsCount,
        transactionsCount,
      };

      logger.info(
        `[Backup] Created backup: ${filename} (${this.formatBytes(stats.size)}, ` +
        `${datasetsCount} datasets, ${transactionsCount} transactions)`,
      );

      await this.rotateBackups();
      return metadata;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Backup] Failed to create backup: ${message}`);
      throw error;
    }
  }

  /**
   * Rotate backups - keep only the most recent N backups
   */
  private async rotateBackups(): Promise<void> {
    try {
      const filesList = await fs.readdir(this.config.backupDir);
      const files = await Promise.all(
        filesList
          .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
          .map(async f => {
            const filePath = path.join(this.config.backupDir, f);
            const stats = await fs.stat(filePath);
            return {
              name: f,
              path: filePath,
              mtime: stats.mtime,
            };
          })
      );
      
      files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Delete old backups beyond maxBackups
      if (files.length > this.config.maxBackups) {
        const toDelete = files.slice(this.config.maxBackups);
        for (const file of toDelete) {
          await fs.unlink(file.path);
          logger.info(`[Backup] Rotated old backup: ${file.name}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Backup] Failed to rotate backups: ${message}`);
    }
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      await this.ensureBackupDirectory();
      const filesList = await fs.readdir(this.config.backupDir);
      const backupFiles = filesList.filter(f => f.startsWith('backup-') && f.endsWith('.json'));
      
      const backups = await Promise.all(
        backupFiles.map(async f => {
          const filePath = path.join(this.config.backupDir, f);
          const stats = await fs.stat(filePath);
          const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
          
          return {
            timestamp: content.metadata?.timestamp || stats.mtime.toISOString(),
            filename: f,
            size: stats.size,
            datasetsCount: content.metadata?.datasetsCount || 0,
            transactionsCount: content.metadata?.transactionsCount || 0,
          };
        })
      );

      return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Backup] Failed to list backups: ${message}`);
      return [];
    }
  }

  /**
   * Restore from a specific backup
   */
  async restoreBackup(filename: string): Promise<void> {
    try {
      const backupPath = path.join(this.config.backupDir, filename);
      
      if (!existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${filename}`);
      }

      const backupContent = JSON.parse(await fs.readFile(backupPath, 'utf-8'));

      // Create a safety backup before restoring
      const safetyBackup = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const safetyPath = path.join(this.config.backupDir, safetyBackup);
      
      // Read current data and save as safety backup
      if (existsSync(DATA_PATH)) {
        const currentData = JSON.parse(await fs.readFile(DATA_PATH, 'utf-8'));
        const safetyData = {
          metadata: {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            datasetsCount: currentData.datasets?.length || 0,
            transactionsCount: currentData.transactions?.length || 0,
          },
          data: currentData,
        };
        await fs.writeFile(safetyPath, JSON.stringify(safetyData, null, 2), 'utf-8');
      }

      // Restore the backup
      await fs.writeFile(DATA_PATH, JSON.stringify(backupContent.data, null, 2), 'utf-8');

      logger.info(`[Backup] Restored from backup: ${filename}`);
      logger.info(`[Backup] Safety backup created: ${safetyBackup}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Backup] Failed to restore backup: ${message}`);
      throw error;
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    totalBackups: number;
    totalSize: number;
    oldestBackup: string | null;
    newestBackup: string | null;
  }> {
    const backups = await this.listBackups();
    
    return {
      totalBackups: backups.length,
      totalSize: backups.reduce((sum, b) => sum + b.size, 0),
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : null,
      newestBackup: backups.length > 0 ? backups[0].timestamp : null,
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

\nimport { logger } from '../lib/logger';