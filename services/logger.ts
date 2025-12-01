// services/logger.ts

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

const MAX_LOG_ENTRIES = 100; // Limit the number of logs to prevent memory issues

class Logger {
  private logs: LogEntry[] = [];
  private static instance: Logger;

  private constructor() {
    // Optionally load from localStorage on init if persistent logs are desired
    // For now, keep it in-memory for session-specific logs.
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private addLog(level: LogEntry['level'], message: string, context?: any) {
    const timestamp = new Date().toISOString();
    let fullMessage = message;
    if (context) {
      if (typeof context === 'object' && context !== null) {
        fullMessage += ` - Details: ${JSON.stringify(context, null, 2)}`;
      } else {
        fullMessage += ` - Details: ${context}`;
      }
    }
    const entry: LogEntry = { timestamp, level, message: fullMessage };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.shift(); // Remove oldest log
    }

    // Log to console as well
    if (level === 'ERROR') {
      console.error(`[${timestamp}] ${level}: ${fullMessage}`);
    } else if (level === 'WARN') {
      console.warn(`[${timestamp}] ${level}: ${fullMessage}`);
    } else {
      console.log(`[${timestamp}] ${level}: ${fullMessage}`);
    }
  }

  public info(message: string, context?: any) {
    this.addLog('INFO', message, context);
  }

  public warn(message: string, context?: any) {
    this.addLog('WARN', message, context);
  }

  public error(message: string, error?: any, context?: any) {
    let errorMessage = message;
    if (error instanceof Error) {
      errorMessage += `: ${error.message}`;
      if (error.stack) {
        errorMessage += `\nStack: ${error.stack}`;
      }
    } else if (typeof error === 'string') {
      errorMessage += `: ${error}`;
    }
    this.addLog('ERROR', errorMessage, context);
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clearLogs() {
    this.logs = [];
  }

  public downloadLogs() {
    const logContent = this.logs
      .map(log => `[${log.timestamp}] ${log.level}: ${log.message}`)
      .join('\n');
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monetiza-studio-log-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const logger = Logger.getInstance();