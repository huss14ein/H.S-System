import { relayToNetlifyFunction } from '../server/vercelApiRelay.js';

export default async function handler(req: {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}, res: {
  status(code: number): unknown;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  send(body: string): void;
  json(body: unknown): void;
}) {
  await relayToNetlifyFunction(req, res, '/api/sahmk-proxy', {
    methods: ['GET', 'OPTIONS'],
    allowBody: false,
  });
}
