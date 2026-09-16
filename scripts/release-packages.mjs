// Which packages a release tag covers. Shared by the release scripts so a new
// package is registered in one place instead of in every script's own list.

// The release train: versioned in lockstep and published from a `vX.Y.Z` tag,
// in dependency order.
export const TRAIN = ['engine', 'core', 'react', 'react-mantine', 'vue'];

// Independently versioned packages. Each is released alone from a
// `<directory>-vX.Y.Z` tag; a train tag also publishes one whose version was
// bumped, since already-published versions are skipped. They come before the
// train because train packages depend on them: engine on
// remark-mark-highlight, react-mantine on code-language-detector.
export const INDEPENDENT = ['remark-mark-highlight', 'code-language-detector'];

export const RELEASE_TAG_PATTERN = new RegExp(`^(?:v|(?:${INDEPENDENT.join('|')})-v)\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?$`);

/** The independent package a package tag names, or null for a train tag. */
function taggedPackage(tag) {
  return tag.startsWith('v') ? null : (INDEPENDENT.find((directory) => tag.startsWith(`${directory}-v`)) ?? null);
}

/** Package directories a release tag publishes and verifies, in publication order. */
export function releaseDirectories(tag) {
  const directory = taggedPackage(tag);
  return directory ? [directory] : [...INDEPENDENT, ...TRAIN];
}

/** The version a release tag names. */
export function releaseVersion(tag) {
  const directory = taggedPackage(tag);
  return tag.slice(directory ? directory.length + 2 : 1);
}
