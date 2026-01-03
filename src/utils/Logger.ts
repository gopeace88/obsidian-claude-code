import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Log directory in user's home.
const LOG_DIR = path.join(os.homedir(), ".obsidian-claude-code");

// File-based logger for debugging.
class Logger {
  private logPath: string;
  private enabled: boolean = true;
  private initialized: boolean = false;

  constructor() {
    this.logPath = path.join(LOG_DIR, "debug.log");
  }

  private ensureLogDir() {
    if (this.initialized) return;
    try {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }
      this.initialized = true;
    } catch (e) {
      console.error("Failed to create log directory:", e);
    }
  }

  setLogPath(vaultPath: string) {
    // We ignore vaultPath now - always use ~/.obsidian-claude-code/
    this.ensureLogDir();
  }

  log(level: "debug" | "info" | "warn" | "error", component: string, message: string, data?: any) {
    if (!this.enabled) return;

    this.ensureLogDir();

    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    const logLine = `[${timestamp}] [${level.toUpperCase()}] [${component}] ${message}${dataStr}\n`;

    // Write to file.
    try {
      fs.appendFileSync(this.logPath, logLine);
    } catch (e) {
      // Fallback to console.
      console.log(logLine);
    }

    // Also log to console.
    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(`[${component}] ${message}`, data || "");
  }

  debug(component: string, message: string, data?: any) {
    this.log("debug", component, message, data);
  }

  info(component: string, message: string, data?: any) {
    this.log("info", component, message, data);
  }

  warn(component: string, message: string, data?: any) {
    this.log("warn", component, message, data);
  }

  error(component: string, message: string, data?: any) {
    this.log("error", component, message, data);
  }

  // Clear the log file.
  clear() {
    try {
      fs.writeFileSync(this.logPath, "");
    } catch (e) {
      // Ignore.
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

// Singleton instance.
export const logger = new Logger();
