import type { DetectionRule } from '../types';
import { cFamilyRules } from './c-family';
import { cExtraRules } from './c-extra';
import { configExtraRules } from './config-extra';
import { dataRules } from './data';
import { docsRules } from './docs';
import { goRules } from './go';
import { independentRules } from './independent';
import { javaRules } from './java';
import { jvmExtraRules } from './jvm-extra';
import { javascriptRules } from './javascript';
import { jsxRules } from './jsx';
import { mobileRules } from './mobile';
import { markupRules } from './markup';
import { pythonRules } from './python';
import { rustRules } from './rust';
import { scriptingRules } from './scripting';
import { sfcRules } from './sfc';
import { shellRules } from './shell';
import { sqlRules } from './sql';
import { stylesRules } from './styles';
import { typescriptRules } from './typescript';

export const ALL_RULES: readonly DetectionRule[] = [
  ...javascriptRules,
  ...typescriptRules,
  ...pythonRules,
  ...shellRules,
  ...goRules,
  ...rustRules,
  ...javaRules,
  ...cFamilyRules,
  ...markupRules,
  ...dataRules,
  ...sqlRules,
  ...stylesRules,
  ...jsxRules,
  ...scriptingRules,
  ...mobileRules,
  ...docsRules,
  ...configExtraRules,
  ...sfcRules,
  ...jvmExtraRules,
  ...cExtraRules,
  ...independentRules,
];
