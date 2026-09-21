import { createApp } from './app.ts';
const port = Number(process.env.PORT || 3000);
const server = createApp().listen(port, '0.0.0.0', () => console.log(`Conversation listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
