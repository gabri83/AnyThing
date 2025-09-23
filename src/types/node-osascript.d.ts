declare module 'node-osascript' {
  type Callback = (err: Error | null, result?: any, raw?: string) => void;

  interface OsascriptModule {
    execute(script: string, cb: Callback): void;
    execute(script: string, vars: Record<string, any>, cb: Callback): void;
  }

  const osascript: OsascriptModule;
  export default osascript;
}




