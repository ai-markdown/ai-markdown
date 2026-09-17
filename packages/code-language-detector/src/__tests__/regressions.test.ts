import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../detector';
import { DetectionCache, StreamingLanguageDetector } from '../streaming';

/**
 * Defects found in code review, each guarded by a test so it cannot regress.
 */

describe('regression: JSX without type evidence keeps both jsx and tsx', () => {
  it('a JSX snippet with no type evidence lists both jsx and tsx as candidates', () => {
    // Only JSX tags and no type evidence at all: jsx and tsx cannot be told apart
    const code = 'const Panel = ({ title }) => (\n  <section className="panel">{title}</section>\n)';
    const result = detectLanguage(code);
    const message = `candidates should include both jsx and tsx, got ${result.candidates.join(',')}`;
    expect(result.candidates, message).toContain('jsx');
    expect(result.candidates, message).toContain('tsx');
  });
});

describe('regression: large and minified JSON', () => {
  const payload = {
    items: Array.from({ length: 4000 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      tags: ['a', 'b'],
      active: i % 2 === 0,
    })),
  };

  it('pretty-printed JSON past the truncation length is still json', () => {
    const code = JSON.stringify(payload, null, 2);
    expect(code.length, 'the sample only means something past MAX_DETECTION_LENGTH').toBeGreaterThan(20_000);
    expect(detectLanguage(code).language).toBe('json');
  });

  it('minified single-line JSON past the truncation length is still json', () => {
    const code = JSON.stringify(payload);
    expect(code.length).toBeGreaterThan(20_000);
    expect(detectLanguage(code).language).toBe('json');
  });

  it('a minified JSON fragment that does not parse at least yields a json candidate', () => {
    // A truncated piece of minified JSON cannot parse, but it should not leave
    // us without any clue either.
    const broken = '{"name":"demo","version":"1.0.0","deps":{"shiki":"^3.22.0","magika":';
    const result = detectLanguage(broken);
    expect(
      result.language === 'json' || (result.candidates as readonly string[]).includes('json'),
      `json should at least be a candidate, got ${JSON.stringify(result)}`
    ).toBe(true);
  });
});

describe('regression: dockerfile and markdown work end to end', () => {
  it('detects a Dockerfile', () => {
    const code = `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["node", "server.js"]`;
    const result = detectLanguage(code);
    expect(result.language).toBe('dockerfile');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('detects Markdown without yaml taking it', () => {
    const code = `# 部署说明

先安装依赖：

- \`npm ci\`
- \`npm run build\`

> 需要 Node 20 以上。

详见 [文档](https://example.com)。`;
    const result = detectLanguage(code);
    expect(result.language).toBe('markdown');
  });
});

describe('regression: comment blocks are not Markdown', () => {
  it('an English comment block at the top of YAML is still yaml', () => {
    // Technical comments commonly start with # and quote identifiers in
    // backticks. On those two features alone they are indistinguishable from
    // Markdown; the counter-evidence "several consecutive # lines" separates
    // them.
    const code = `name: Release Desktop

# Builds and publishes the desktop app for macOS, Windows and
# Linux, plus the \`latest.yml\` release feed that goes with it.
# See the docs for details.
on:
  push:
    tags: [v*]
`;
    expect(detectLanguage(code).language).toBe('yaml');
  });

  it('a comment block at the top of a shell script is still bash', () => {
    const code = `#!/usr/bin/env bash
# This script builds the project.
# It requires \`node\` and \`pnpm\` on PATH.
# Usage: ./build.sh
set -euo pipefail
`;
    expect(detectLanguage(code).language).toBe('bash');
  });

  it('a real Markdown document is unaffected', () => {
    const code = `# 部署说明

先安装依赖，再启动服务：

- \`npm ci\`
- \`npm run build\`

> 注意：需要 Node 20 以上。
`;
    expect(detectLanguage(code).language).toBe('markdown');
  });
});

describe('regression: reusing the streaming detector across fences', () => {
  it('a new block fed after finalize does not return the previous block’s language', () => {
    const detector = new StreamingLanguageDetector();

    const rust =
      'use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    println!("{:?}", m);\n}';
    detector.update(rust);
    const first = detector.finalize(rust);
    expect(first.language).toBe('rust');

    // A new fence, shorter content
    const python = 'def greet(name):\n    return f"hi {name}"\n';
    const second = detector.update(python);
    expect(second.language, 'after finalize the new content must be judged on its own').not.toBe('rust');
    expect(detector.finalize(python).language).toBe('python');
  });

  it('a longer new block fed after finalize is re-detected as well', () => {
    const detector = new StreamingLanguageDetector();
    const short = 'package main\n\nfunc main() {}';
    detector.finalize(short);

    const longer = `interface User {
  id: string
  email: string
}

export function greet(user: User): string {
  return \`hello \${user.email}\`
}`;
    const result = detector.update(longer);
    expect(result.language).not.toBe('go');
  });
});

describe('regression: rolled-back content and re-renders in the streaming detector', () => {
  const rust =
    'use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    println!("{:?}", m);\n}';

  it('shorter content fed without finalize invalidates the old verdict', () => {
    const detector = new StreamingLanguageDetector();
    expect(detector.update(rust).language).toBe('rust');

    // The caller switched straight to a shorter fence: the growth check used to
    // stay false forever and keep returning rust.
    const result = detector.update('def greet(name):');
    expect(result.language, 'once the content is shorter the old content’s language must not come back').not.toBe(
      'rust'
    );
  });

  it('updating with the same content after finalize reuses the result object', () => {
    const detector = new StreamingLanguageDetector();
    const final = detector.finalize(rust);
    // React re-renders ask about the same code over and over; that must not
    // trigger a reset and a re-detection.
    expect(detector.update(rust)).toBe(final);
  });

  it('switching families costs a margin, and finalize is no exception', () => {
    // Setup: a high-confidence python prefix, then a large block of SQL that
    // tips the overall evidence towards sql.
    const python = 'def load(path):\n    return open(path).read()\n';
    const mixed = `${python}\nSELECT id FROM users;\nINSERT INTO users (id) VALUES (1);\nUPDATE users SET id = 2 WHERE id = 1;\nCREATE TABLE t (id INT);\nDROP TABLE t;\n`;
    const a = detectLanguage(python);
    const b = detectLanguage(mixed);
    expect(a.language, 'setup: the prefix should be python').toBe('python');
    expect(b.language, 'setup: the whole should be sql').toBe('sql');
    expect(
      b.confidence,
      `setup: sql's confidence ${b.confidence} should not beat python's ${a.confidence} by 0.1`
    ).toBeLessThan(a.confidence + 0.1);

    const sticky = new StreamingLanguageDetector({ lockConfidence: 2 });
    sticky.update(python);
    expect(
      sticky.update(mixed).language,
      'a cross-family switch without clearly higher confidence is not accepted'
    ).toBe('python');
    // finalize used to be exempt from the margin, and a GitHub Actions file
    // jumped from yaml to bash when its fence closed. A cross-family switch at
    // close now has to beat the margin too, so the verdict from streaming holds.
    expect(sticky.finalize(mixed).language, 'a cross-family switch in finalize pays the margin too').toBe('python');

    const loose = new StreamingLanguageDetector({ lockConfidence: 2, familySwitchMargin: 0 });
    loose.update(python);
    expect(loose.update(mixed).language, 'a margin of 0 restores the old behaviour').toBe('sql');
  });
});

describe('regression: DetectionCache is LRU, not FIFO', () => {
  it('a recently hit entry is not evicted first', () => {
    const cache = new DetectionCache(2);
    const a = 'package main\n\nfunc main() {}\n';
    const first = cache.detect(a);
    cache.detect('def f():\n    pass\n');
    cache.detect(a); // hit, refreshed to most recent
    cache.detect('SELECT * FROM t WHERE id = 1'); // the python entry is the one to evict
    expect(cache.size).toBe(2);
    expect(cache.detect(a), 'a was just hit and must not have been evicted').toBe(first);
  });
});

describe('regression: a definitive rule only boosts when it is unique', () => {
  it('Rust’s use std:: also fires C++’s std::, but cpp is pushed down by a negative score and rust stays at 0.95', () => {
    const result = detectLanguage('use std::io;');
    expect(result.language).toBe('rust');
    expect(result.confidence, `confidence ${result.confidence}`).toBeGreaterThanOrEqual(0.95);
  });

  it('no 0.95 when strong signatures of two languages survive together', () => {
    // py-def (python) and sql-ddl (sql) are both definitive, and sql is not
    // pushed down by a negative score.
    const result = detectLanguage('def f():\n    pass\n\nCREATE TABLE t (id INT)');
    expect(result.confidence, `conflicting evidence should stay below 0.95, got ${result.confidence}`).toBeLessThan(
      0.95
    );
  });
});

describe('regression: 0.95 misdetections caused by definitive rules written too broadly', () => {
  const cases: [string, string, string][] = [
    ['Drizzle’s select().from()', 'sql', `const rows = await db.select().from(users).where(eq(users.id, 1))`],
    ["'Set-Cookie' in JS", 'powershell', `res.setHeader('Set-Cookie', cookie)`],
    ['Test-Driven in a comment', 'powershell', `// Test-Driven approach\nconst x = 1`],
    ['an HTTP response header', 'powershell', `HTTP/1.1 200 OK\nSet-Cookie: session=abc`],
    ['source venv/bin/activate', 'applescript', `source venv/bin/activate`],
    ['two C int declarations', 'asm', `int main(void) {\n    int a = 1;\n    int b = 2;\n}`],
    ['Python typing’s List[str]', 'scala', `names: List[str] = []`],
    ['std::process inside a Rust function body', 'cpp', `fn main() {\n    std::process::exit(1);\n}`],
    ['C++’s Eigen::Matrix', 'julia', `Eigen::Matrix<double, 3, 3> m;`],
    ['a lone @property line', 'objective-c', `@property`],
    ['Markdown’s - (Optional)', 'objective-c', `- (Optional) Add tests`],
  ];
  for (const [name, wrong, code] of cases) {
    it(`${name} is not detected as ${wrong}`, () => {
      const result = detectLanguage(code);
      expect(result.language, `evidence: ${result.evidence.join(',')}`).not.toBe(wrong);
    });
  }
});

describe('regression: callers cannot corrupt returned values', () => {
  it('the unknown result is frozen, so a push does not affect later calls', () => {
    const first = detectLanguage('hello world');
    expect(Object.isFrozen(first), 'the unknown result should be frozen').toBe(true);
    expect(() => {
      (first.candidates as string[]).push('javascript');
    }, 'push on a frozen array should throw (strict mode)').toThrow();
    const second = detectLanguage('foo bar baz');
    expect(second.candidates, 'later calls must not see a corrupted candidate list').toEqual([]);
  });
});

describe('regression: keywords shared across languages must be split equally', () => {
  it('a plain JS class snippet keeps javascript among the candidates', () => {
    const code = `class Shape {
  area() {
    return 0
  }
}`;
    const result = detectLanguage(code);
    const pool: readonly string[] = result.language ? [result.language] : result.candidates;
    expect(
      pool.includes('javascript') || pool.includes('typescript'),
      `the candidates should include the JS family, got ${JSON.stringify(result)}`
    ).toBe(true);
  });
});

describe('regression: ties are ordered by popularity', () => {
  it('javascript ranks before typescript when JS/TS evidence is tied', () => {
    const result = detectLanguage('function add(a, b) {\n  return a + b\n}');
    expect(result.language, 'no type evidence, so no language should be named').toBe(null);
    expect(result.candidates).toEqual(['javascript', 'typescript']);
  });

  it('c ranks before cpp when C/C++ evidence is tied', () => {
    const result = detectLanguage('#include <stdio.h>\n\nint main() {}');
    expect(result.candidates).toEqual(['c', 'cpp']);
  });

  it('the candidates of a bare class snippet follow popularity exactly', () => {
    // java 7.54 > csharp 4.22 > javascript 2.76 > typescript 0.43
    const result = detectLanguage('class Shape {\n  area() {\n    return 0\n  }\n}');
    expect(result.candidates).toEqual(['java', 'csharp', 'javascript', 'typescript']);
  });

  it('popularity only applies to ties and cannot outweigh evidence', () => {
    // typescript is far less popular than java/csharp, but interface plus type
    // annotations are hard evidence.
    const result = detectLanguage(
      'interface User {\n  id: string\n}\n\nexport function greet(u: User): string {\n  return u.id\n}'
    );
    expect(result.language).toBe('typescript');
  });
});

describe('regression: Dart named parameters must not match any pair of braces', () => {
  it('{ return 0 } is not taken for Dart named parameters', () => {
    const result = detectLanguage('class Shape {\n  area() {\n    return 0\n  }\n}');
    expect(result.candidates, `dart should not be a candidate, got ${result.candidates.join(',')}`).not.toContain(
      'dart'
    );
  });

  it('real Dart named parameters are still detected', () => {
    const code = `class Button extends StatelessWidget {
  const Button({required String label, VoidCallback? onTap});
}`;
    expect(detectLanguage(code).language).toBe('dart');
  });
});

/**
 * The cases below were exposed by the real GitHub corpus
 * (scripts/github-curated.tsv). With every synthetic fixture passing, these
 * forms were still misdetected, because handwritten samples lean
 * systematically towards textbook style. The samples are original code
 * re-created in the same shape as the corpus files, not quotations from them.
 */
describe('regression: real corpus · Svelte / Vue streaming prefixes', () => {
  it('a prefix starting with <script lang="ts"> before the template arrives is not typescript', () => {
    const prefix = `<script lang="ts">
  import type { Task } from "$lib/types";
  export let tasks: Task[] = [];
  let expanded = false;`;
    const result = detectLanguage(prefix);
    expect(result.language).not.toBe('typescript');
    expect(result.candidates, `candidates should include svelte, got ${result.candidates.join(',')}`).toContain(
      'svelte'
    );
  });

  it('<script module> is svelte', () => {
    const code = `<script lang="ts" module>
  export interface Props {
    name: string;
  }
</script>`;
    expect(detectLanguage(code).language).toBe('svelte');
  });

  it('Handlebars {{#each}} does not match Svelte block syntax', () => {
    const code = `<ul class="list">
  {{#each items}}
    <li>{{this.name}}</li>
  {{/each}}
</ul>`;
    expect(detectLanguage(code).language).not.toBe('svelte');
  });
});

describe('regression: real corpus · Scala and Go share the package form', () => {
  it('a single-segment package name with unquoted dotted imports is not go', () => {
    const code = `package controllers

import cats.syntax.all.*
import play.api.libs.json.Json

class OrdersController {
}`;
    const result = detectLanguage(code);
    expect(result.language).not.toBe('go');
    expect(result.language).toBe('scala');
  });

  it('two consecutive package clauses are scala', () => {
    const code = 'package acme.core\npackage billing\n\nimport play.api.libs.json.Json\n\ntrait InvoiceApi';
    expect(detectLanguage(code).language).toBe('scala');
  });

  it('import x._ and import x.{A, B} are scala', () => {
    const code = 'import scala.collection.mutable._\nimport akka.actor.{Actor, Props}\n\nclass Worker extends Actor';
    expect(detectLanguage(code).language).toBe('scala');
  });

  it('real Go is unaffected', () => {
    const code = 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(1)\n}';
    expect(detectLanguage(code).language).toBe('go');
  });

  it('a dotted import without a semicolon is split equally across Python / Kotlin / Scala, and Python wins on from-import', () => {
    const code =
      'import os.path\nimport numpy as np\nfrom typing import List\n\ndef f(xs: List[int]) -> int:\n    return len(xs)';
    expect(detectLanguage(code).language).toBe('python');
  });
});

describe('regression: real corpus · MATLAB element-wise operators must not span lines', () => {
  it('the .* of a Scala wildcard import does not join the next line into a multiplication', () => {
    const code = 'import cats.syntax.all.*\nimport play.api.libs.json.Json';
    expect(detectLanguage(code).candidates).not.toContain('matlab');
  });

  it('real MATLAB element-wise operations are still detected', () => {
    const code = 'x = linspace(0, 1, 10);\ny = x .* 2;\nz = y ./ 3;\ndisp(z)';
    expect(detectLanguage(code).language).toBe('matlab');
  });
});

describe('regression: real corpus · the body of a Julia docstring is Markdown', () => {
  it('a Julia file with a license comment header and a docstring is not markdown', () => {
    const code = `# SPDX-License-Identifier: MIT

"""
    AbstractQueue{T}

A first-in, first-out container holding values of type \`T\`.
"""
abstract type AbstractQueue{T} end

enqueue!(q::AbstractQueue, v) = (push!(q, v); q)`;
    expect(detectLanguage(code).language).toBe('julia');
  });

  it('a ## banner comment plus a constant docstring is not markdown', () => {
    const code = `# SPDX-License-Identifier: MIT

# Note: this file is \`include\`d into the enclosing module Storage

## Buffer Flags (platform-specific) ##

"""
    BUF_READABLE
    BUF_WRITABLE
    BUF_SHARED`;
    expect(detectLanguage(code).language).not.toBe('markdown');
  });

  it('a where clause is julia', () => {
    const code = 'function summarize(io::IO, table::AbstractDict{K,V}) where V where K\n    print(io, "x")\nend';
    expect(detectLanguage(code).language).toBe('julia');
  });

  it('a real Markdown document is unaffected', () => {
    const code =
      '# 部署说明\n\n先安装依赖：\n\n- `npm ci`\n- `npm run build`\n\n> 需要 Node 20 以上。\n\n详见 [文档](https://example.com)。';
    expect(detectLanguage(code).language).toBe('markdown');
  });
});

describe('regression: real corpus · AppleScript as actually written', () => {
  it('starting with use AppleScript version is applescript', () => {
    const code =
      'use AppleScript version "2.4" -- macOS 10.10 or later\nuse scripting additions\n\n-- Bump the version below when you change this script';
    expect(detectLanguage(code).language).toBe('applescript');
  });

  it('property declarations are applescript', () => {
    const code =
      '-- Script options:\n-- https://example.com/acme-scripts\n\n-- Set this property to true to skip the prompt\nproperty skip_confirmation : false\n\nproperty show_notifications : true';
    expect(detectLanguage(code).language).toBe('applescript');
  });

  it('on run argv plus text item delimiters is applescript', () => {
    const code = `on run argv
	global _seen
	set _seen to {}
	set _savedDelimiters to AppleScript's text item delimiters
end run`;
    expect(detectLanguage(code).language).toBe('applescript');
  });
});

describe('regression: consecutive YAML mappings (yaml-mapping-run)', () => {
  it('a FUNDING.yml with only top-level keys and trailing comments is yaml', () => {
    const code = `# Sponsorship links for this project

github: [your-username]
patreon: # Add a Patreon username here
open_collective: # Add an Open Collective project name here
ko_fi: # Add a Ko-fi username here`;
    expect(detectLanguage(code).language).toBe('yaml');
  });

  it('nested mappings are yaml', () => {
    const code = `service:
  display_name: "Weather Report"
  short_description: "Summarize tomorrow's forecast."
  default_prompt: "Use the weather-report tool."
limits:
  allow_background_refresh: true`;
    expect(detectLanguage(code).language).toBe('yaml');
  });

  const notYaml: Record<string, string> = {
    'a TS interface (no semicolons)': 'interface User {\n  id: string\n  email: string\n  name: string\n}',
    'a Python dataclass': '@dataclass\nclass Job:\n    name: str\n    retries: int = 3\n    tags: List[str]',
    'CSS properties': '.card {\n  display: grid;\n  gap: 12px;\n  padding: 16px;\n}',
    'a JS object literal': 'const cfg = {\n  port: 8080,\n  host: "localhost",\n  debug: true,\n}',
    'a Swift struct': 'struct User {\n    let id: Int\n    let name: String\n    var active: Bool\n}',
  };
  for (const [name, code] of Object.entries(notYaml)) {
    it(`${name} is not detected as yaml`, () => {
      expect(detectLanguage(code).language).not.toBe('yaml');
    });
  }
});

describe('regression: MASM assembly', () => {
  it('MASM-style SEGMENT / ASSUME / INCLUDE directives are asm', () => {
    const code = `;
; heap allocation helpers for the example loader
;
INCLUDE ACMESEG.ASM

CODE    SEGMENT BYTE PUBLIC  'CODE'
        ASSUME  SS:ACMEGROUP,CS:ACMEGROUP

.xlist
.cref
TITLE HEAP.ASM - block allocator`;
    expect(detectLanguage(code).language).toBe('asm');
  });

  it('only semicolon comments is not ini (semicolon comments are split equally between INI and assembly)', () => {
    const code = ';\n; The loader below is split into two sections.\n; The first section stays in memory.\n;';
    expect(detectLanguage(code).language).not.toBe('ini');
  });

  it('a CSS .list class selector does not match a MASM dot directive', () => {
    const result = detectLanguage('.list {\n  display: flex;\n  gap: 8px;\n}');
    expect(result.language).toBe('css');
  });

  it('real INI is still ini', () => {
    const code = '[server]\nhost = 127.0.0.1\nport = 8080\n; 日志相关\n[log]\nlevel = info';
    expect(detectLanguage(code).language).toBe('ini');
  });
});

describe('regression: HTML tags inside comments are not HTML evidence', () => {
  it('a browser script whose JSDoc shows a <script> usage example is not html', () => {
    const code = `/**
 * Layout Check Helper
 *
 * Usage: <script src="layout-check.js"></script>
 * Re-run: window.acmeLayoutCheck()
 */
(function () {
if (typeof window === 'undefined') return;
const SAFE_TAGS = new Set([
  'blockquote', 'nav', 'a', 'input',
]);`;
    const result = detectLanguage(code);
    expect(result.language).not.toBe('html');
    expect(result.candidates, `candidates should include javascript, got ${result.candidates.join(',')}`).toContain(
      'javascript'
    );
  });

  it('a CSS comment mentioning <style> does not affect the css verdict', () => {
    const code = '/*\n * 用法：把这段放进 <style> 标签\n */\n.card {\n  display: grid;\n  gap: 12px;\n}';
    expect(detectLanguage(code).language).toBe('css');
  });

  it('<style> inside an SCSS /* */ comment is still scss', () => {
    const code = '/* Usage: <style>@import "theme";</style> */\n$primary: #161a21;\n\n.card {\n  @include card;\n}';
    expect(detectLanguage(code).language).toBe('scss');
  });
});

describe('regression: formatted HTML snippets', () => {
  it('a <meta> with one attribute per line plus a <style> block is html, not taken by CSS', () => {
    const code = `<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
/>
<style>
  html,
  body {
    height: 100%;
    overflow: hidden;
    margin: 0;
  }
</style>`;
    expect(detectLanguage(code).language).toBe('html');
  });

  it('Vue’s <style scoped lang="scss"> does not affect the vue verdict', () => {
    const code =
      '<template>\n  <div class="c">{{ x }}</div>\n</template>\n<style scoped lang="scss">\n.c { $pad: 4px; padding: $pad; }\n</style>';
    expect(detectLanguage(code).language).toBe('vue');
  });
});

describe('regression: shell embedded in CI configuration must not turn YAML into bash', () => {
  const workflow = `name: Desktop Release

on:
  push:
    tags:
      - "v*"

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: |
          set -euo pipefail
          if [[ -z "\${VERSION:-}" ]]; then
            VERSION=$(git describe --tags)
          fi
          export VERSION
          for arch in x64 arm64; do
            ./scripts/build.sh "$arch" | tee "build-$arch.log"
          done
      - name: Upload
        run: |
          set -e
          if [ -f dist/app.dmg ]; then
            echo "uploading \${VERSION}"
          fi`;

  it('a large shell block under run: | does not make the whole file bash', () => {
    expect(detectLanguage(workflow).language).not.toBe('bash');
  });

  it('a GitLab CI script list is yaml', () => {
    const code = 'stages:\n  - test\n\ntest:\n  stage: test\n  script:\n    - npm ci\n    - npm test\n';
    expect(detectLanguage(code).language).toBe('yaml');
  });

  it('a bash script writing run: | into a heredoc is still bash', () => {
    const code = `#!/usr/bin/env bash
set -euo pipefail

cat > .github/workflows/ci.yml <<EOF
jobs:
  build:
    steps:
      - run: |
          npm ci
EOF

if [[ -f ci.yml ]]; then
  echo done
fi`;
    expect(detectLanguage(code).language).toBe('bash');
  });

  it('once streaming has locked yaml, finalize does not switch families on seeing more shell in the complete content', () => {
    const detector = new StreamingLanguageDetector();
    for (let end = 40; end < workflow.length; end += 40) detector.update(workflow.slice(0, end));
    const streamed = detector.current.language;
    const final = detector.finalize(workflow);
    expect(streamed).toBe('yaml');
    expect(final.language, 'the highlighting must not jump from YAML to another family when the fence closes').toBe(
      'yaml'
    );
  });
});

describe('regression: adoption rules of finalize', () => {
  it('refinement within a family is adopted: typescript while streaming, tsx once JSX appears in the complete content', () => {
    const detector = new StreamingLanguageDetector();
    const head = `import { useState } from 'react'

interface Props {
  initial: number
}

export function Counter({ initial }: Props) {
  const [count, setCount] = useState<number>(initial)`;
    detector.update(head);
    const full = `${head}
  return <div className="c"><button onClick={() => setCount(count + 1)}>+</button></div>
}`;
    expect(detector.finalize(full).language).toBe('tsx');
  });

  it('when the complete content yields no language, the verdict from streaming is kept', () => {
    const detector = new StreamingLanguageDetector();
    const rust =
      'use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    println!("{:?}", m);\n}';
    detector.update(rust);
    expect(detector.current.language).toBe('rust');
    // Append a long stretch of prose that dilutes the evidence, like a fence
    // that ends in a long comment or program output.
    const diluted = `${rust}\n${'lorem ipsum dolor sit amet\n'.repeat(400)}`;
    expect(detector.finalize(diluted).language).toBe('rust');
  });
});

describe('regression: HTML inside strings is not HTML evidence', () => {
  it('a TS test file asserting on HTML output is not html', () => {
    const code = `import { describe, expect, it } from 'vitest'
import { renderReportPage } from './render-report-page'

describe('renderReportPage', () => {
  it('wraps the body in a complete standalone document', () => {
    const html = renderReportPage({
      title: 'Report',
      body: '<h1>Report</h1><p>ready</p>'
    })
    expect(html).toContain('<meta charset="utf-8"')
    expect(html).toContain('<style>')
  })

  it('escapes HTML-unsafe characters in the title', () => {
    const html = renderReportPage({ title: '<script>alert(1)</script>' })
    expect(html).toContain('<title>&lt;script&gt;</title>')
  })
})`;
    expect(detectLanguage(code).language).not.toBe('html');
  });

  it('a real HTML snippet is unaffected', () => {
    const code = '<div class="wrap">\n  <p>hello <b>world</b></p>\n  <style>.a{color:red}</style>\n</div>';
    expect(detectLanguage(code).language).toBe('html');
  });
});

describe('regression: a # comment header of only two lines', () => {
  it('a two-line wrapped comment plus a mapping sequence is yaml, not markdown', () => {
    const code = `# Optional settings for Acme Sync 2.4.0. Install the matching \`acme-sync\` binary
# first; the sync folder and account stay managed by the tool.
- insert:
    - id: sync-acme`;
    expect(detectLanguage(code).language).toBe('yaml');
  });

  it('Markdown with two consecutive heading levels is not taken for a comment', () => {
    const code = '# 部署指南\n## Getting started\n\n先安装依赖：\n\n- `npm ci`\n\n详见 [文档](https://example.com)。';
    expect(detectLanguage(code).language).toBe('markdown');
  });
});

describe('regression: lots of TS in the script block must not turn a Svelte / Vue component into typescript', () => {
  it('with TS rules piling up in the script block, the whole component is still svelte', () => {
    // A realistic component: dozens of typed TS lines, with the template far below
    const tsBody = Array.from(
      { length: 30 },
      (_, i) => `\tconst item${i}: Item | undefined = items.find((x) => x.id === ids[${i}]) as Item;`
    ).join('\n');
    const code = `<script lang="ts">
	import { formatLabel } from "$lib/format";
	import type { Item } from "$lib/types";

	type Props = { items: Item[]; onSelect?: (id: string) => void };
	let { items, onSelect }: Props = $props();
	const ids: string[] = items.map((x) => x.id);
${tsBody}
	async function pick(id: string): Promise<void> {
		onSelect?.(id);
	}
</script>

<div class="picker">
	{#each items as item}
		<button onclick={() => pick(item.id)}>{item.name}</button>
	{/each}
</div>`;
    expect(detectLanguage(code).language).toBe('svelte');
  });

  it('an HTML snippet starting with <script> is still html', () => {
    const code = '<script src="app.js"></script>\n<div class="wrap"><p>hi</p></div>';
    expect(detectLanguage(code).language).toBe('html');
  });
});

describe('regression: after excludes removes JS/TS a usable candidate list remains', () => {
  it('with only a <script> block and no template, the candidates are non-empty and contain no JS/TS', () => {
    // excludes is a hard filter: if it emptied the candidate list, the caller
    // would have nothing left to choose from and could only render plain text.
    for (const code of [
      '<script>\nconst x = 1\n</script>',
      '<script lang="ts">\nconst x: number = 1\nexport function f(a: string): string { return a }\n</script>',
    ]) {
      const result = detectLanguage(code);
      expect(result.candidates.length, `the candidates must not be empty: ${JSON.stringify(result)}`).toBeGreaterThan(
        0
      );
      for (const excluded of ['javascript', 'typescript', 'jsx', 'tsx']) {
        expect(result.candidates, `${excluded} should have been removed by excludes`).not.toContain(excluded);
      }
    }
  });
});

/**
 * Thin snippets from the tuning corpus that had one piece of evidence and stayed
 * below the confidence line. Each rule adds a second, independent signature, and
 * each has a lookalike from another language that must stay unaffected.
 */
describe('regression: a second signature for thin snippets', () => {
  it('VB.NET inheritance modifiers are vb', () => {
    const code =
      'Imports System.Text\n\n<Serializable()>\nPublic MustInherit Class Shape\n    MustOverride Function Area() As Double\n';
    expect(detectLanguage(code).language).toBe('vb');
  });

  it('C# abstract members are not vb', () => {
    const code = 'using System.Text;\n\npublic abstract class Shape\n{\n    public abstract double Area();\n}';
    expect(detectLanguage(code).language).not.toBe('vb');
  });

  it('a MATLAB function with a single output is matlab', () => {
    const code = 'function total = addAll(values)\n% ADDALL sums a vector\n    total = sum(values);\nend';
    expect(detectLanguage(code).language).toBe('matlab');
  });

  it('Lua and JavaScript function declarations are not matlab', () => {
    expect(detectLanguage('function add(a, b)\n  return a + b\nend\n\nprint(add(1, 2))').language).not.toBe('matlab');
    expect(detectLanguage('const twice = function (x) {\n  return x * 2;\n};').language).not.toBe('matlab');
  });

  it('a Julia import with names and an indented export block is julia', () => {
    const code =
      '# SPDX-License-Identifier: MIT\n\nimport Base: show, length\n\nexport\n    Queue,\n    enqueue!,\n    dequeue!,\n    peek\n';
    expect(detectLanguage(code).language).toBe('julia');
  });

  it('Python and Elixir imports are not julia', () => {
    expect(detectLanguage('from base import show\nimport os\n\ndef main():\n    show(os.getcwd())').language).not.toBe(
      'julia'
    );
    expect(detectLanguage('defmodule Report do\n  import Enum, only: [map: 2]\nend').language).not.toBe('julia');
  });

  it('a component script importing from svelte or a .svelte file is svelte', () => {
    const code =
      "<script lang=\"ts\">\n  import { onMount } from 'svelte';\n  import Card from './Card.svelte';\n\n  let count = 0;\n  onMount(() => (count = 1));\n";
    expect(detectLanguage(code).language).toBe('svelte');
  });

  it('a TypeScript store module and a Vue component are not svelte', () => {
    expect(
      detectLanguage("import { writable } from 'svelte/store';\n\nexport const count = writable<number>(0);").language
    ).not.toBe('svelte');
    expect(
      detectLanguage('<script setup lang="ts">\nimport Card from \'./Card.vue\';\nconst count = ref(0);\n</script>')
        .language
    ).not.toBe('svelte');
  });
});
