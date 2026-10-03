import { test } from 'vitest';
import { preprocessLaTeX } from './latex';

// ── Fixture builders ────────────────────────────────────────────────────────

// Representative ~1 KB markdown chunk with text, code, LaTeX, HTML, tables.
const realisticChunk = `# Section Title

Intro paragraph with \`inline code\` and some **bold** and _italic_ text.
We also have inline math $E = mc^2$ and a display block:

$$
\\int_0^\\infty e^{-x} dx = 1
$$

Inside a paragraph: the price is \\$100 and the formula \\(x^2 + y^2 = z^2\\).

\`\`\`ts
const x = 1;
const y = "$100";  // string with dollar
\`\`\`

| Name  | Value  | Note   |
|-------|--------|--------|
| alpha | $x^2$  | ok     |
| beta  | $200   | price  |
| gamma | \\(y^2\\) | math   |

HTML bits: <span>value</span> then <br/> and <div class="note">see here</div>.

Mixed with \`$lookup\` code and $\\text{Total} = \\$500$.

`;

// Realistic document: repeat the chunk to hit ~10 KB.
const realisticDoc = realisticChunk.repeat(10);

// Stress-test the O(n) refactor in escapeCurrencyDollarSigns.
// Each repeated line contains a LaTeX expression with multiple `$N` currency
// matches inside — this is exactly the "odd parity" path that previously
// called `parts.join('')` on every match (O(n²) in the line count).
const currencyStressLine = '- $A = P + Prt = $1,000 + ($1,000)(0.05)(2) = $1,100$ per year.';
const currencyStressDoc = `${currencyStressLine}\n`.repeat(200);

// Stress-test the sticky-regex refactor in splitByProtectedRegions.
// Many `<` characters force the HTML-tag regex check on each occurrence;
// the old implementation created a new substring per `<`.
const htmlStressChunk = '<span>a</span><br/><div>b</div><em>c</em><strong>d</strong> text $x^2$ ';
const htmlStressDoc = htmlStressChunk.repeat(200);

// Stress-test the other sticky-regex path: `<` characters that DON'T match any
// known HTML tag (math comparisons, Obsidian-style angle-bracket links, custom
// tag names). These trigger a regex attempt per `<` that fails, which is a
// separate hot path from the success-match case above.
const htmlFalsePositiveChunk = 'a < b and b < c < d; see <Section A> for $x^2$ and <CustomTag> too. ';
const htmlFalsePositiveDoc = htmlFalsePositiveChunk.repeat(200);

// ── Benchmarks ─────────────────────────────────────────────────────────────

test('preprocessLaTeX', async ({ bench }) => {
  await bench('realistic ~10 KB markdown document', () => {
    preprocessLaTeX(realisticDoc);
  }).run();

  await bench('currency-inside-LaTeX stress (O(n²) → O(n) path)', () => {
    preprocessLaTeX(currencyStressDoc);
  }).run();

  await bench('many HTML tags, success path (sticky regex matches)', () => {
    preprocessLaTeX(htmlStressDoc);
  }).run();

  await bench('many `<` characters, false-positive path (sticky regex misses)', () => {
    preprocessLaTeX(htmlFalsePositiveDoc);
  }).run();
});
