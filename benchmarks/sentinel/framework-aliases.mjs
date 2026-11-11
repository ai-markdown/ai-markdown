import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

// The harness lives in the candidate checkout, but each library revision must
// share its own framework instance with the harness (hooks and schedulers).
export function frameworkAliases(packageDir, adapter) {
  const require = createRequire(resolve(packageDir, 'package.json'));
  const packages = adapter === 'react' ? ['react', 'react-dom'] : ['vue'];
  return Object.fromEntries(packages.map((name) => [name, dirname(require.resolve(`${name}/package.json`))]));
}
