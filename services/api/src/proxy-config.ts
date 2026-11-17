import { isIP } from 'node:net';

// Trust only the dedicated reverse-proxy peer, never arbitrary forwarded headers.
export function configureProxy(
  app: { set: (key: string, value: unknown) => unknown },
  env: NodeJS.ProcessEnv,
) {
  const peer = env.TRUSTED_PROXY_IP;
  if (peer && !isIP(peer))
    throw new Error('TRUSTED_PROXY_IP must be one exact IP');
  if (env.NODE_ENV === 'production') {
    const origin = new URL(env.CORS_ORIGIN ?? 'invalid:');
    if (origin.protocol !== 'https:' || origin.origin !== env.CORS_ORIGIN)
      throw new Error('Production CORS_ORIGIN must be one HTTPS origin');
  }
  app.set('trust proxy', peer ? [peer] : false);
}
