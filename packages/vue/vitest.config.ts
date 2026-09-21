import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { fsModuleCache: true, environment: 'node', include: ['src/**/*.test.ts'] } });
