declare module 'node-osascript' {
  export function execute(script: string, callback: (err: Error | null, result: any) => void): void;
  export function executeFile(scriptPath: string, callback: (err: Error | null, result: any) => void): void;
}