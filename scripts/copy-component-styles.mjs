import { copyFileSync, mkdirSync } from 'node:fs';
// Run from the adapter package after its JS build has created dist.
mkdirSync('dist/components', { recursive: true });
copyFileSync('../core/styles/components.css', 'dist/components/styles.css');
