import { databaseLogger } from "./logger.js";

export class DatabaseSaveTrigger {
  private static saveFunction: (() => Promise<void>) | null = null;
  private static isInitialized = false;
  private static pendingSave = false;
  private static saveTimeout: NodeJS.Timeout | null = null;
  private static _dirty = false;
  // A save asked for while another is writing. The running save serialized
  // the database before that write landed, so one more save runs after it.
  private static rerunRequested = false;

  static initialize(saveFunction: () => Promise<void>): void {
    this.saveFunction = saveFunction;
    this.isInitialized = true;
  }

  static get isDirty(): boolean {
    return this._dirty;
  }

  static markClean(): void {
    this._dirty = false;
  }

  static async triggerSave(
    reason: string = "data_modification",
  ): Promise<void> {
    if (!this.isInitialized || !this.saveFunction) {
      databaseLogger.warn("Database save trigger not initialized", {
        operation: "db_save_trigger_not_init",
        reason,
      });
      return;
    }

    this._dirty = true;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      if (this.pendingSave) {
        this.rerunRequested = true;
        return;
      }

      this.pendingSave = true;

      try {
        await this.saveFunction!();
        this._dirty = false;
      } catch (error) {
        databaseLogger.error("Database save failed", error, {
          operation: "db_save_trigger_failed",
          reason,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        this.pendingSave = false;
        this.runRequestedRerun();
      }
    }, 2000);
  }

  static async forceSave(reason: string = "critical_operation"): Promise<void> {
    if (!this.isInitialized || !this.saveFunction) {
      databaseLogger.warn(
        "Database save trigger not initialized for force save",
        {
          operation: "db_save_trigger_force_not_init",
          reason,
        },
      );
      return;
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.pendingSave) {
      this.rerunRequested = true;
      return;
    }

    this.pendingSave = true;

    try {
      await this.saveFunction();
    } catch (error) {
      databaseLogger.error("Database force save failed", error, {
        operation: "db_save_trigger_force_failed",
        reason,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      this.pendingSave = false;
      this.runRequestedRerun();
    }
  }

  private static runRequestedRerun(): void {
    if (!this.rerunRequested) return;
    this.rerunRequested = false;
    databaseLogger.info("Re-running a save requested while another was writing", {
      operation: "db_save_trigger_rerun",
    });
    this.forceSave("rerun_after_overlap").catch(() => {
      // forceSave already logged the failure.
    });
  }

  static getStatus(): {
    initialized: boolean;
    pendingSave: boolean;
    hasPendingTimeout: boolean;
  } {
    return {
      initialized: this.isInitialized,
      pendingSave: this.pendingSave,
      hasPendingTimeout: this.saveTimeout !== null,
    };
  }

  static cleanup(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    this.pendingSave = false;
    this.rerunRequested = false;
    this.isInitialized = false;
    this.saveFunction = null;
  }
}
