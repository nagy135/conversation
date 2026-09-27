/** Normalize configuration URLs, but only accept serialized browser origins. */
export function acceptsOrigin(requestOrigin: string | undefined, configuredOrigin: string): boolean {
  if (!requestOrigin) return false;
  const configured = new URL(configuredOrigin.trim());
  if (!['http:', 'https:'].includes(configured.protocol)) return false;
  if (requestOrigin === configured.origin) return true;

  // Local development can be opened using either loopback hostname. Keep the
  // protocol and port exact, and never extend this exception to a public host.
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (!loopback.includes(configured.hostname)) return false;
  return loopback.some(hostname => {
    const alias = new URL(configured.origin);
    alias.hostname = hostname;
    return requestOrigin === alias.origin;
  });
}
