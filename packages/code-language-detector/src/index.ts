export { CodeLanguage } from './language';
export type { LanguageDetectionResult } from './types';
export { detectLanguage } from './detector';
export { DetectionCache, StreamingLanguageDetector } from './streaming';
export type { StreamingLanguageDetectorOptions } from './streaming';
export { normalizeCodeLanguage } from './aliases';
export { normalizeHighlightJsLanguage, normalizeShikiLanguage } from './highlighterNames';
export { toHighlightJsLanguage, toShikiLanguage } from './converters';
