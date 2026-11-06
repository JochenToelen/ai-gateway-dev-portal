import type { IncomingMessage, ServerResponse } from 'node:http';

export function createPricingHandler(
  env?: Record<string, string | undefined>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
