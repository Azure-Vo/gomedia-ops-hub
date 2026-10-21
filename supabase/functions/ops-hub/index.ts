// Deno entry point for Supabase Edge Functions.
import { readEnv } from './env';
import { createHandler } from './handler';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): unknown };

Deno.serve(createHandler(readEnv((key) => Deno.env.get(key))));
