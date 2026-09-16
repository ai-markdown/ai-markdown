import type { DetectionRule } from '../types';

/**
 * Objective-C and Zig.
 * The Objective-C discrimination patterns come from GitHub Linguist's `named_patterns.objectivec`
 * (lib/linguist/heuristics.yml, MIT License), which exists precisely to tell .h files apart from
 * C / C++, the same need as here.
 */
export const cExtraRules: DetectionRule[] = [
  // ── Objective-C ─────────────────────────────────────────────────
  {
    id: 'objc-at-directive',
    // `@property` must carry a parenthesised attribute list: a bare `@property` is a Python decorator
    pattern:
      /^[ \t]*@(?:interface|implementation|protocol|end|selector|synthesize|autoreleasepool)\b|^[ \t]*@property\s*\(/m,
    scores: { 'objective-c': 12, c: -5, cpp: -5, swift: -2 },
    definitive: 'objective-c',
  },
  {
    id: 'objc-import-header',
    pattern: /^[ \t]*#import\s+[<"][\w./]{1,60}\.h[>"]/m,
    scores: { 'objective-c': 11, c: -4, cpp: -4 },
    definitive: 'objective-c',
  },
  {
    id: 'objc-message-send',
    // [obj method:arg] bracketed message send
    pattern: /\[\s*(?:self|super|[A-Z]\w{0,40}|\w{1,40})\s+\w{1,40}(?::|\s*\])/,
    scores: { 'objective-c': 7, c: -2 },
  },
  {
    id: 'objc-method-decl',
    // The return type is either a built-in ObjC type or an object pointer with *:
    // otherwise the Markdown list item `- (Optional) Add tests` would match too
    pattern:
      /^[ \t]*[-+]\s*\(\s*(?:void|id|instancetype|BOOL|NSInteger|NSUInteger|CGFloat|(?:NS|UI|CG)\w+\s*\*?|[A-Z]\w*\s*\*)\s*\)\s*\w+/m,
    scores: { 'objective-c': 11, c: -3 },
    definitive: 'objective-c',
  },
  {
    id: 'objc-ns-types',
    pattern:
      /\bNS(?:String|Array|Dictionary|Number|Object|Error|Mutable\w+)\s*\*|\b(?:nonatomic|retain|nullable|nonnull)\b/,
    scores: { 'objective-c': 8, swift: -1 },
  },
  {
    id: 'objc-literal',
    pattern: /@"[^"\n]{0,120}"|@\[|@\{/,
    scores: { 'objective-c': 7 },
  },

  // ── Zig ─────────────────────────────────────────────────────────
  {
    id: 'zig-import-std',
    pattern: /\bconst\s+\w+\s*=\s*@import\s*\(\s*"/,
    scores: { zig: 12, rust: -3 },
    definitive: 'zig',
  },
  {
    id: 'zig-builtin',
    // Builtins such as @as / @intCast / @sizeOf are unique to Zig
    pattern: /@(?:as|intCast|sizeOf|TypeOf|ptrCast|alignOf|field|compileError|panic|min|max)\s*\(/,
    scores: { zig: 11, 'objective-c': -3 },
    definitive: 'zig',
  },
  {
    id: 'zig-fn-error-union',
    // pub fn main() !void: the ! error union type is a Zig signature
    pattern: /^[ \t]*(?:pub\s+)?(?:export\s+)?fn\s+\w+\s*\([^)\n]{0,120}\)\s*(?:!|\w+!|anyerror!)/m,
    scores: { zig: 12, rust: -4 },
    definitive: 'zig',
  },
  {
    id: 'zig-comptime-defer',
    pattern: /\bcomptime\s+\w|\berrdefer\b|\bundefined\s*;|\ballocator\s*:\s*(?:std\.mem\.Allocator|Allocator)/,
    scores: { zig: 9, rust: -2 },
  },
  {
    id: 'zig-try-catch-expr',
    pattern: /\btry\s+\w[\w.]{0,40}\(|\bcatch\s*(?:\|\w+\|)?\s*(?:\{|return|unreachable)/,
    scores: { zig: 8, rust: -2 },
  },
];
