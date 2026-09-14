import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebar, readingNavigation } from './navigation.mjs';
import { pages } from './content.mjs';

test('every canonical topic appears once in the bilingual sidebar', () => {
  const items = sidebar.flatMap((group) => group.items);
  const slugs = items.map((item) => item.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'Duplicate sidebar topic');
  assert.deepEqual(
    [...slugs].sort(),
    pages()
      .filter((page) => !page.locale)
      .map((page) => page.slug)
      .sort()
  );
  for (const item of [...sidebar, ...items]) {
    assert.ok(item.label);
    assert.match(item.translations['zh-CN'], /[\u3400-\u9fff]|React|Vue|Core|Engine|Mantine/);
  }
});

test('framework tutorials advance within their reading path in both deployments and languages', () => {
  for (const base of ['/', '/ai-markdown/']) {
    for (const locale of [undefined, 'zh-cn']) {
      const prefix = locale ? `${locale}/` : '';
      for (const [framework, next] of [
        ['react', 'streaming-chat-example'],
        ['vue', 'vue-streaming'],
        ['react-mantine', 'mantine-code-blocks'],
      ]) {
        const navigation = readingNavigation(`${prefix}docs/guides/${framework}-quick-start`, locale, base);
        assert.equal(navigation.prev.link, `${base}${prefix}docs/guides/getting-started/`);
        assert.equal(navigation.next.link, `${base}${prefix}docs/guides/${next}/`);
        if (locale) assert.match(navigation.next.label, /[\u3400-\u9fff]/);
      }
      assert.equal(readingNavigation(`${prefix}docs`, locale, base).prev, false);
      assert.deepEqual(readingNavigation(`${prefix}docs/engine`, locale, base), {});
    }
  }
});
