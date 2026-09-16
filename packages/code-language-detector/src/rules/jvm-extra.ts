import type { DetectionRule } from '../types';

/**
 * Groovy and Scala. Both run on the JVM and share most keywords with Java / Kotlin,
 * so only forms unique to each are picked, with a negative score for the language most likely to steal the
 * points.
 */
export const jvmExtraRules: DetectionRule[] = [
  // ── Groovy ──────────────────────────────────────────────────────
  {
    id: 'groovy-gradle-dsl',
    // Most Groovy in agent output is Gradle build scripts
    pattern: /^[ \t]*(?:plugins|dependencies|repositories|android|subprojects|allprojects)\s*\{/m,
    scores: { groovy: 11, java: -3, kotlin: -2 },
    definitive: 'groovy',
  },
  {
    id: 'groovy-gradle-dep',
    pattern: /^[ \t]*(?:implementation|api|compileOnly|testImplementation|runtimeOnly|classpath)\s+['"]/m,
    scores: { groovy: 10, kotlin: -2 },
  },
  {
    id: 'groovy-def',
    pattern: /^[ \t]*def\s+\w+\s*(?:=|\([^)\n]{0,80}\)\s*\{)/m,
    scores: { groovy: 8, python: -2, ruby: -2 },
    description: 'def followed by an assignment or a braced method body, unlike the Python/Ruby def forms',
  },
  {
    id: 'groovy-closure-it',
    pattern: /\{\s*(?:\w+\s*->|[^{}\n]{0,40}\bit\b[.\s])/,
    scores: { groovy: 6, kotlin: 3 },
  },
  {
    id: 'groovy-gstring',
    pattern: /"[^"\n]{0,80}\$\{?\w/,
    scores: { groovy: 4, kotlin: 3, scala: 2 },
  },
  {
    id: 'groovy-annotation-grab',
    pattern: /@(?:Grab|GrabConfig|CompileStatic|TypeChecked|Canonical|ToString)\b/,
    scores: { groovy: 10 },
    definitive: 'groovy',
  },

  // ── Scala ───────────────────────────────────────────────────────
  {
    id: 'scala-bracket-generic',
    // Scala writes generics with square brackets: Option[String], Seq[Int], Map[String, Int].
    // Python typing has none of these names (it uses Optional / Dict / Sequence), so this can be definitive
    pattern: /\b(?:Option|Seq|Map|Array|Future|Either|Try|Vector)\[[\w\s,._[\]]{1,60}\]/,
    scores: { scala: 11, java: -3, kotlin: -2 },
    definitive: 'scala',
  },
  {
    id: 'scala-list-set-generic',
    // List[…] / Set[…] has the same form as Python typing's List[str] / Set[User],
    // so it only counts as weak evidence that puts both into the candidates
    pattern: /\b(?:List|Set)\[[\w\s,._[\]]{1,60}\]/,
    scores: { scala: 5, python: 3 },
  },
  {
    id: 'scala-case-class',
    pattern: /^[ \t]*(?:final\s+|sealed\s+)?case\s+(?:class|object)\s+\w+/m,
    scores: { scala: 12, kotlin: -3, java: -3 },
    definitive: 'scala',
  },
  {
    id: 'scala-def-equals',
    // def f(x: Int): Int = expr: defining a method body with an equals sign is the Scala form
    pattern: /^[ \t]*(?:(?:private|protected|override|implicit|final)\s+)*def\s+\w+[^\n=]{0,120}=\s*\S/m,
    scores: { scala: 10, python: -3, groovy: -2 },
  },
  {
    id: 'scala-object-trait',
    pattern: /^[ \t]*(?:(?:sealed|abstract|final)\s+)?(?:object|trait)\s+\w+/m,
    scores: { scala: 9, kotlin: -2, java: -2 },
  },
  {
    id: 'scala-import',
    // The character class must include *: a Scala 3 wildcard import is written import cats.syntax.all.*
    pattern: /^[ \t]*import\s+(?:scala|akka|cats|zio|play\.api|org\.apache\.spark)\.[\w.{}, _*=>]{1,120}$/m,
    scores: { scala: 10 },
    definitive: 'scala',
  },
  {
    id: 'scala-import-selector',
    // import x._ and import x.{A, B}: only Scala writes an underscore wildcard or a brace selector.
    // Kotlin uses import x.* and Python uses from x import, neither of which has this shape.
    pattern: /^[ \t]*import\s+[\w.]{1,100}\.(?:_|\{[^}\n]{1,100}\})[ \t]*$/m,
    scores: { scala: 11, kotlin: -3, python: -3 },
    definitive: 'scala',
  },
  {
    id: 'scala-chained-package',
    // Two consecutive package clauses (package acme.core / package billing) are unique to Scala
    pattern: /^[ \t]*package\s+[\w.]{1,80}[ \t]*\n[ \t]*package\s+\w/m,
    scores: { scala: 10, go: -6, kotlin: -3 },
  },
  {
    id: 'scala-implicit-given',
    pattern: /\b(?:implicit\s+(?:val|def|class)|given\s+\w+\s*:|using\s+\w+\s*:)/,
    scores: { scala: 9 },
  },
];
