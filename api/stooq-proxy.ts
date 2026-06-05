import { relayToNetlifyFunction } from '../server/vercelApiRelay';

export default async function handler(req: Parameters<typeof relayToNetlifyFunction>[0], res: Parameters<typeof relayToNetlifyFunction>[1]) {
  await relayToNetlifyFunction(req, res, '/api/stooq-proxy', {
    methods: ['GET', 'OPTIONS'],
    allowBody: false,
  });
}
