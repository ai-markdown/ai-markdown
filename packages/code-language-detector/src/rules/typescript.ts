import type { DetectionRule } from '../types';

/**
 * TS-only syntax. Every rule also gives javascript a negative score, which is the key to separating JS from TS:
 * adding points to TS alone would make "JS that happens to contain interface" hard to tell from real TS.
 */
export const typescriptRules: DetectionRule[] = [
  {
    id: 'ts-interface',
    // Java/C# have interface too, but their other strong features (System.out / using System) win the points back
    pattern: /^[ \t]*(?:export\s+)?interface\s+[A-Za-z_$][\w$]*/m,
    scores: { typescript: 9, tsx: 5, javascript: -8 },
  },
  {
    id: 'ts-type-alias',
    pattern: /^[ \t]*(?:export\s+)?type\s+[A-Za-z_$][\w$]*(?:<[^>\n]{0,80}>)?\s*=/m,
    scores: { typescript: 10, tsx: 5, javascript: -8 },
  },
  {
    id: 'ts-enum',
    pattern: /^[ \t]*(?:export\s+)?(?:const\s+)?enum\s+[A-Za-z_$][\w$]*/m,
    scores: { typescript: 7, javascript: -6, java: 2, csharp: 2 },
  },
  {
    id: 'ts-var-annotation',
    // Only TS spells primitive type names in lowercase (string / number / boolean):
    // Swift / Kotlin primitives are String / Int, capitalized, and go through the equal-split rule below
    pattern: /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*(?:string|number|boolean|any|unknown|never|void|readonly)\b/,
    scores: { typescript: 9, tsx: 5, javascript: -6 },
    description: 'Lowercase primitive type annotation, unique to TS',
  },
  {
    id: 'ts-var-annotation-typed',
    // `let x: Foo` looks identical in TS and Swift, and so does Kotlin's `var x: Foo`.
    // The split must be equal: TS 9 / Swift 5 used to fabricate a 4-point margin out of nothing,
    // which detected Swift code like `public let ownerPID: Int32` as typescript 0.94
    pattern: /\b(?:let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[A-Z][\w$]*/,
    scores: { typescript: 6, tsx: 4, swift: 6, kotlin: 5, javascript: -6 },
    description: 'Capitalized type annotation, split equally between TS / Swift / Kotlin',
  },
  {
    id: 'ts-const-annotation-typed',
    // `const x: Foo`: Swift has no const and Kotlin's is `const val`, so this rule can go to TS alone
    pattern: /\bconst\s+[A-Za-z_$][\w$]*\s*:\s*[A-Z][\w$]*/,
    scores: { typescript: 8, tsx: 4, javascript: -6 },
  },
  {
    id: 'ts-generic-primitive',
    // A lowercase primitive inside generic arguments (Map<string, number> / Promise<void>):
    // Swift / Kotlin generic arguments are capitalized type names, and JS has no generics.
    // `<` must directly follow an identifier, which rules out HTML's `<input type="number">`;
    // no `:` inside the angle brackets, which rules out C++'s `vector<std::string>`;
    // `string` looks the same in C# (`List<string>`), so it is split off into the equal-split rule below
    pattern: /\w<[^<>:\n]{0,40}\b(?:number|boolean|void|unknown|any|never)\b[^<>:\n]{0,40}>/,
    scores: { typescript: 7, tsx: 4, javascript: -4 },
  },
  {
    id: 'ts-cs-generic-string',
    pattern: /\w<[^<>:\n]{0,40}\bstring\b[^<>:\n]{0,40}>/,
    scores: { typescript: 4, tsx: 2, csharp: 4, javascript: -3 },
    description: 'Lowercase string inside generics, split equally between TS and C#',
  },
  {
    id: 'ts-param-annotation',
    pattern: /\(\s*[A-Za-z_$][\w$]*\s*:\s*(?:string|number|boolean|any|unknown|never|void|object|symbol|bigint)\b/,
    scores: { typescript: 8, tsx: 5, javascript: -5 },
    description: 'Lowercase primitive parameter type, unique to TS',
  },
  {
    id: 'ts-param-annotation-typed',
    // `(name: String)` is everyday TS / Swift / Kotlin / Scala, so the split is equal.
    // Dart puts the type first (`String name`) and is not part of this rule
    pattern: /\(\s*[A-Za-z_$][\w$]*\s*:\s*[A-Z][\w$<>[\]|. ]{0,40}[,)]/,
    scores: { typescript: 6, tsx: 4, swift: 6, kotlin: 6, scala: 3, javascript: -5 },
  },
  {
    id: 'ts-return-type',
    pattern: /\)\s*:\s*(?:string|number|boolean|void|never|unknown|any|Promise\s*<)/,
    // A lowercase primitive return type is a TS feature; Swift/Kotlin write -> Int / : Unit and do not match
    scores: { typescript: 8, javascript: -5 },
  },
  {
    id: 'ts-optional-member',
    // `name?: string`. A ternary `a ? b : c` always has an expression in the middle, so it never matches an adjacent ?:
    pattern: /\b[A-Za-z_$][\w$]*\?\s*:/,
    scores: { typescript: 7, javascript: -4 },
  },
  {
    id: 'ts-as-cast',
    pattern: /\bas\s+(?:const\b|[A-Z][\w$]*)/,
    scores: { typescript: 5, javascript: -2 },
  },
  {
    id: 'ts-namespace',
    pattern: /^[ \t]*(?:export\s+)?namespace\s+[A-Za-z_$][\w$]*/m,
    scores: { typescript: 6, csharp: 3, javascript: -4 },
  },
  {
    id: 'ts-access-modifier',
    // Rules out `public init(`: that is a Swift initializer; TS writes constructor
    pattern: /^[ \t]*(?:public|private|protected|readonly)\s+(?!init\b)[A-Za-z_$][\w$]*\s*[:(]/m,
    scores: { typescript: 5, java: 2, csharp: 2, javascript: -3 },
  },
  {
    id: 'ts-generic-fn',
    // Generics on their own are not strong evidence (the design notes say so explicitly); this only adds a little
    // when the snippet already leans towards TS
    pattern: /\bfunction\s+[A-Za-z_$][\w$]*<[A-Za-z_$][\w$,\s]{0,40}>\s*\(/,
    scores: { typescript: 4 },
  },
  {
    id: 'ts-satisfies',
    pattern: /\bsatisfies\s+[A-Z][\w$]*/,
    scores: { typescript: 6, javascript: -3 },
  },
];
