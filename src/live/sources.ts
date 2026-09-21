import type { Source, ServerEvent } from './types';

/** Only turn actual citation metadata into links; never interpret model text as HTML. */
export function collectSources(current: Source[], event: NonNullable<ServerEvent['event']>): Source[] {
  const annotations: unknown[] = [];
  if (event.type === 'response.output_text.annotation.added') annotations.push(event.annotation);
  if (event.type === 'response.output_item.done' && event.item?.type === 'message') {
    for (const content of event.item.content ?? []) {
      if (content.type === 'output_text' && Array.isArray(content.annotations)) annotations.push(...content.annotations);
    }
  }
  const sources = new Map(current.map(source => [source.url, source]));
  for (const candidate of annotations) {
    if (!candidate || typeof candidate !== 'object') continue;
    const annotation = candidate as Record<string, unknown>;
    if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') continue;
    try {
      const url = new URL(annotation.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      sources.set(url.href, {
        url: url.href,
        title: typeof annotation.title === 'string' && annotation.title.trim() ? annotation.title.trim() : url.hostname,
      });
    } catch { /* Ignore malformed citation metadata. */ }
  }
  return [...sources.values()].slice(-20);
}
