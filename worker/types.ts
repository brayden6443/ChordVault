export interface D1Result<T = Record<string, unknown>> { success: boolean; results: T[]; meta?: { changes?: number } }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}
export interface WorkerEnv { DB: D1Database; ASSETS?: { fetch(request: Request): Promise<Response> }; ALLOW_ADMIN_MUTATIONS: string }
