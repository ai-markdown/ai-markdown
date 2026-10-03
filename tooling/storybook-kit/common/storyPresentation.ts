/** Presentation only: keep instrumentation canvases and regression fixtures bare. */
export function storyPresentation(title: string, name: string, viewMode: string, layout?: string) {
  const bare = title.startsWith('QA/') || title.includes('/QA/') || title.startsWith('Performance Lab/');
  return {
    bare,
    heading: viewMode === 'story' && !bare && layout !== 'fullscreen',
    breadcrumb: title.replaceAll('/', ' / '),
    name,
  };
}
