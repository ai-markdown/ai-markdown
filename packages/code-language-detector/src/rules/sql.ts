import type { DetectionRule } from '../types';

/**
 * SQL is easy to detect with high confidence through paired patterns: a lone SELECT is not enough,
 * a paired structure such as SELECT ... FROM is the strong evidence.
 */
export const sqlRules: DetectionRule[] = [
  {
    id: 'sql-select-from',
    // SELECT must be followed by whitespace and then a column expression (`*`, an identifier, a quoted identifier, a
    // function), and FROM by a table name or a subquery. Both constraints are required:
    //   - Drizzle / Knex's `db.select().from(users)` is `select(`, not `SELECT x`
    //   - in `import { Select, SelectItem } from '@/ui/select'` FROM is followed by a quoted string
    // Both forms are more common than real SQL in agent output, and both used to be detected as sql 0.95.
    //   - `import Select from "antd/lib/select"` names a component, so SELECT right after import does not count
    pattern: /(?<!\bimport\s{1,8})\bSELECT\s+(?:\*|[\w"`[])[\s\S]{0,400}?\bFROM\s+[\w"`[(]/i,
    scores: { sql: 11 },
    definitive: 'sql',
  },
  {
    id: 'sql-insert-into',
    pattern: /\bINSERT\s+INTO\s+[\w."`[\]]+/i,
    scores: { sql: 11 },
    definitive: 'sql',
  },
  {
    id: 'sql-update-set',
    pattern: /\bUPDATE\s+[\w."`[\]]+\s+SET\b/i,
    scores: { sql: 11 },
    definitive: 'sql',
  },
  {
    id: 'sql-ddl',
    pattern: /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|VIEW|DATABASE|SCHEMA)\b/i,
    scores: { sql: 11 },
    definitive: 'sql',
  },
  {
    id: 'sql-in-string-literal',
    // A quote directly followed by an SQL verb: an SQL string in a host language (`cur.execute("SELECT …")`),
    // and the highlighting belongs to the host language. A plain SQL file never wraps whole statements in quotes
    pattern: /["'`]\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i,
    scores: { sql: -8 },
  },
  {
    id: 'sql-cte',
    pattern: /\bWITH\s+\w+\s+AS\s*\(/i,
    scores: { sql: 8 },
  },
  {
    id: 'sql-join',
    pattern: /\b(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+(?:OUTER\s+)?JOIN\b/i,
    scores: { sql: 8 },
  },
  {
    id: 'sql-clause-tail',
    pattern: /\b(?:GROUP\s+BY|ORDER\s+BY|HAVING)\b/i,
    scores: { sql: 6 },
  },
  {
    id: 'sql-where',
    // No \b after the comparison operator: there is no word boundary between `=` and the following space,
    // so `WHERE id = 1` used to never match, only `WHERE id =1` did
    pattern: /\bWHERE\s+[\w."`[\]]+\s*(?:[=<>]|\b(?:LIKE|IN|IS|BETWEEN)\b)/i,
    scores: { sql: 5 },
  },
];
