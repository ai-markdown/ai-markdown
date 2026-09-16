import type { DetectionRule } from '../types';

/** Visual Basic / MATLAB / Julia / Assembly / AppleScript */
export const independentRules: DetectionRule[] = [
  // ── Visual Basic ────────────────────────────────────────────────
  {
    id: 'vb-dim-as',
    pattern: /^[ \t]*(?:Dim|Private|Public|Friend)\s+\w+\s+As\s+[\w().]+/m,
    scores: { vb: 11 },
    definitive: 'vb',
  },
  {
    id: 'vb-end-block',
    // End Sub / End Function / End If: two-word block terminators are a VB signature
    pattern: /^[ \t]*End\s+(?:Sub|Function|If|Class|Module|Select|While|With|Try|Namespace)\b/m,
    scores: { vb: 11 },
    definitive: 'vb',
  },
  {
    id: 'vb-sub-function',
    // No i flag: an all-lowercase function is almost certainly JS / PHP / Lua,
    // while VB convention (and IDE auto-formatting) capitalises the first letter
    pattern: /^[ \t]*(?:(?:Public|Private|Protected|Friend|Shared|Overrides)\s+)*(?:Sub|Function)\s+\w+\s*\(/m,
    scores: { vb: 9 },
  },
  {
    id: 'vb-imports',
    pattern: /^[ \t]*Imports\s+[\w.]+[ \t]*$/m,
    scores: { vb: 9 },
  },
  {
    id: 'vb-then-keyword',
    // No i flag here either: a lowercase if ... then is everyday Lua / Shell
    pattern: /\bIf\s+[^\n]{1,120}\s+Then\b|^[ \t]*Else(?:If)?\b/m,
    scores: { vb: 6 },
  },

  // ── MATLAB ──────────────────────────────────────────────────────
  {
    id: 'matlab-function-brackets',
    // function [out1, out2] = name(args): multiple return values in square brackets are unique to MATLAB
    pattern: /^[ \t]*function\s*\[[^\]\n]{0,80}\]\s*=\s*\w+\s*\(/m,
    scores: { matlab: 12, julia: -3 },
    definitive: 'matlab',
  },
  {
    id: 'matlab-percent-comment',
    // Linguist uses ^\s*% to tell MATLAB apart from the other .m languages
    pattern: /^[ \t]*%(?:%|\s)[^\n]{0,120}$/m,
    scores: { matlab: 7, julia: -2, python: -1 },
  },
  {
    id: 'matlab-elementwise-op',
    // .* ./ .^ element-wise operators; Julia's broadcasting (.+ .-) is a wider form.
    // Only [ \t] is allowed around the operator and the right operand must be on the same line: the old \s*
    // crossed line breaks and joined a Scala `import cats.syntax.all.*` with the next line's `import` into a
    // multiplication.
    pattern: /\w[ \t]*\.(?:\*|\/|\^)[ \t]*[\w(]/,
    scores: { matlab: 8, julia: 3 },
  },
  {
    id: 'matlab-builtin',
    pattern: /\b(?:disp|fprintf|numel|linspace|meshgrid|isempty|strcmp|nargin|nargout)\s*\(/,
    scores: { matlab: 8 },
  },
  {
    id: 'matlab-end-keyword-block',
    pattern: /^[ \t]*(?:endfunction|endfor|endwhile|endif)\b/m,
    scores: { matlab: 9 },
  },

  // ── Julia ───────────────────────────────────────────────────────
  {
    id: 'julia-type-annotation',
    // x::Int64 double-colon type annotations are a Julia signature.
    // A lowercase identifier (a Julia variable name) is required before `::`, which excludes the
    // "namespace::Type" forms of C++'s `Eigen::Matrix<…>` and Ruby's `ActiveRecord::Type::String.new`;
    // it must not be followed directly by < : ( . , which are C++ templates, path continuations, calls and
    // member access
    pattern:
      /(?<![\w:.])[a-z_]\w*\s*::\s*(?:Int\d*|Float\d*|String|Bool|Vector|Matrix|Array|Any|Real|Number|AbstractString)\b(?![<:(.])/,
    scores: { julia: 11, matlab: -3 },
    definitive: 'julia',
  },
  {
    id: 'julia-docstring-signature',
    // Julia docstring convention: """ alone at the start of a line, then the call signature indented by 4
    // spaces on the next line. The docstring body is Markdown (inline code, [x](@ref) links, ## headings, code
    // fences), so the body alone would be detected as markdown; this structure is what separates the two.
    // A Python docstring sits inside a def, with the """ itself indented, so it does not have this shape.
    // The signature line may also be just a constant name (JL_O_APPEND indented under """), so the
    // parenthesised part is optional
    pattern: /^"""[ \t]*\n {4}[\w.!@]{1,60}(?:[({][^\n]{0,160})?$/m,
    scores: { julia: 11, markdown: -8, python: -3 },
    definitive: 'julia',
  },
  {
    id: 'julia-documenter-markup',
    // Specific to Documenter.jl: ```jldoctest fences, the julia> REPL prompt, [`x`](@ref) cross-references
    pattern: /```jldoctest|^julia>[ \t]|\]\(@ref\)/m,
    scores: { julia: 9, markdown: -4 },
  },
  {
    id: 'julia-abstract-type',
    pattern: /^[ \t]*abstract\s+type\s+[A-Z]\w{0,40}(?:\{[^}\n]{0,40}\})?(?:\s*<:\s*[\w{}]{1,40})?\s+end\b/m,
    scores: { julia: 12 },
    definitive: 'julia',
  },
  {
    id: 'julia-export-list',
    // export a, b, c: no braces, whereas a JS export needs { }
    pattern: /^export\s+[a-z_@][\w!]{0,40},[ \t]*[\w!@, \t]{1,240}$/m,
    scores: { julia: 9, javascript: -2, typescript: -2 },
  },
  {
    id: 'julia-import-modules',
    // import Genie, Genie.Router: comma-separated capitalised module names; Python's import os, sys is
    // lowercase
    pattern: /^(?:import|using)\s+[A-Z][\w.]{0,40},[ \t]*[A-Z]/m,
    scores: { julia: 8, python: -1 },
  },
  {
    id: 'julia-short-method',
    // enqueue!(q::AbstractQueue, v) = expr: a one-line method definition with :: parameter annotations
    pattern: /^[\w!.]{1,40}\([^)\n]{0,80}\b[a-z_]\w{0,30}::[A-Z]\w{0,40}[^)\n]{0,80}\)\s*=\s/m,
    scores: { julia: 10, rust: -2 },
  },
  {
    id: 'julia-where-clause',
    // function f(x::T) where {T}: the where clause of a parametric method is unique to Julia
    pattern: /\)\s*where\s*\{?\s*[A-Z]\w{0,20}(?:\s*<:\s*\w{1,30})?\s*\}?/,
    scores: { julia: 12, rust: -3 },
    definitive: 'julia',
  },
  {
    id: 'julia-anon-type-param',
    // ::Type{T} anonymous parameter type annotation, preceded by a comma or an opening parenthesis
    pattern: /[(,]\s*::\s*(?:Type|AbstractArray|AbstractVector|Union)\s*\{/,
    scores: { julia: 10 },
  },
  {
    id: 'julia-using-import',
    pattern: /^[ \t]*using\s+[A-Z][\w,. ]{0,80}[ \t]*$/m,
    scores: { julia: 9, csharp: -2 },
  },
  {
    id: 'julia-struct-end',
    pattern: /^[ \t]*(?:mutable\s+)?struct\s+\w+[^\n]{0,80}\n(?:[^\n]{0,200}\n){0,20}?[ \t]*end\b/m,
    scores: { julia: 9, rust: -2 },
  },
  {
    id: 'julia-macro',
    pattern: /@(?:time|show|test|inbounds|views|assert|printf|everywhere|kwdef)\b/,
    scores: { julia: 10, matlab: -2 },
    definitive: 'julia',
  },
  {
    id: 'julia-function-end',
    // function f(x) ... end, without MATLAB's bracketed return values
    pattern: /^[ \t]*function\s+\w+\s*\([^)\]\n]{0,80}\)[ \t]*$/m,
    scores: { julia: 6, matlab: 4 },
  },

  // ── Assembly ────────────────────────────────────────────────────
  {
    id: 'masm-segment-assume',
    // MASM: `CODE SEGMENT BYTE PUBLIC 'CODE'` and `ASSUME CS:CODE,DS:DATA`.
    // The other assembly rules only cover NASM / GAS (section .text, %rax); MASM sources such as MS-DOS match
    // none of them.
    pattern:
      /^[ \t]*\w{1,40}[ \t]+(?:SEGMENT|segment)\b[^\n]{0,60}$|^[ \t]*(?:ASSUME|assume)[ \t]+(?:CS|DS|SS|ES|cs|ds|ss|es):/m,
    scores: { asm: 12 },
    definitive: 'asm',
  },
  {
    id: 'masm-directives',
    // PROC / ENDP / ENDS and directives such as TITLE, INCLUDE, EXTRN (all uppercase by MASM convention).
    // Dot directives such as .xlist / .model must stand alone on their line, which excludes CSS's `.list {` and
    // Less's `.code();`
    pattern:
      /^[ \t]*(?:\w{1,40}[ \t]+(?:PROC|ENDP|ENDS)\b|(?:TITLE|SUBTTL|INCLUDE|EXTRN|PUBLIC)[ \t]+\S|\.(?:xlist|xcref|cref|list|model|code|data|stack)(?:[ \t]+\w[^\n{(;]{0,40})?[ \t]*$)/m,
    scores: { asm: 9 },
  },
  {
    id: 'asm-section-directive',
    pattern: /^[ \t]*(?:section|segment)\s+\.(?:text|data|bss|rodata)\b|^[ \t]*\.(?:text|data|bss|globl|global)\b/m,
    scores: { asm: 12 },
    definitive: 'asm',
  },
  {
    id: 'asm-mnemonics',
    // Mnemonics have to appear in a group: a single mov may be an identifier in another language.
    // `int` only counts as a mnemonic when followed by an interrupt number (`int 0x80` / `int 21h`);
    // otherwise two consecutive C lines `int a = 1;` would be detected as assembly
    pattern:
      /^[ \t]*(?:mov|push|pop|lea|add|sub|xor|cmp|jmp|je|jne|call|ret|syscall|int\s+(?:0x[0-9a-f]+|\d+h?))\s+[^\n]{0,60}\n(?:[^\n]{0,80}\n){0,6}?[ \t]*(?:mov|push|pop|lea|add|sub|xor|cmp|jmp|je|jne|call|ret|syscall|int\s+(?:0x[0-9a-f]+|\d+h?))\b/im,
    scores: { asm: 11 },
    definitive: 'asm',
  },
  {
    id: 'asm-register',
    pattern: /%(?:r[a-d]x|rsi|rdi|rsp|rbp|eax|ebx|ecx|edx)\b|\b(?:r[a-d]x|rsi|rdi|rsp|rbp|eax|ebx|ecx|edx)\s*,/,
    scores: { asm: 8 },
  },
  {
    id: 'asm-data-directive',
    pattern: /^[ \t]*\w{1,40}:\s*\n?[ \t]*(?:db|dw|dd|dq|resb|resw|equ)\s+/m,
    scores: { asm: 9 },
  },

  // ── AppleScript ─────────────────────────────────────────────────
  {
    id: 'applescript-tell',
    pattern: /^[ \t]*tell\s+(?:application|app)\s+["'][^"'\n]{1,60}["']/im,
    scores: { applescript: 13 },
    definitive: 'applescript',
  },
  {
    id: 'applescript-end-tell',
    pattern: /^[ \t]*end\s+(?:tell|repeat|if|try)\b/m,
    scores: { applescript: 6 },
  },
  {
    id: 'applescript-set-to',
    pattern: /^[ \t]*set\s+\w[\w ]{0,40}\s+to\s+\S/m,
    scores: { applescript: 9, bash: -2 },
  },
  {
    id: 'applescript-verbs',
    // `activate` and `on run` must stand alone on their line: `source venv/bin/activate` and an "on run" in a
    // comment both used to turn the whole snippet into applescript 0.95
    pattern:
      /\b(?:display\s+dialog|display\s+notification|do\s+shell\s+script)\b|^[ \t]*(?:activate|on\s+run)[ \t]*$/im,
    scores: { applescript: 10 },
    definitive: 'applescript',
  },
  {
    id: 'applescript-use-statement',
    // use AppleScript version "2.4" / use scripting additions / use script "Lib"
    pattern: /^[ \t]*use\s+(?:AppleScript\s+version\s+"|scripting\s+additions\b|script\s+")/m,
    scores: { applescript: 13 },
    definitive: 'applescript',
  },
  {
    id: 'applescript-property-decl',
    // property name : value: the name and the value are separated by "space colon space".
    // Objective-C's @property carries an @ and parentheses, and TS class properties have no property keyword
    pattern: /^[ \t]*property\s+[A-Za-z_]\w{0,40}\s+:\s+\S/m,
    scores: { applescript: 11, 'objective-c': -2 },
    definitive: 'applescript',
  },
  {
    id: 'applescript-handler',
    // on run argv / on run {a, b} / on handlerName(args)
    pattern: /^[ \t]*on\s+(?:run\s+(?:argv\b|\{)|[A-Za-z_]\w{0,40}\()/m,
    scores: { applescript: 9 },
  },
  {
    id: 'applescript-builtin-phrases',
    // Built-in expressions phrased like natural language, which no other language writes
    pattern:
      /AppleScript's\s+text\s+item\s+delimiters|\bpath\s+to\s+(?:me|desktop|home\s+folder)\b|\bload\s+script\s+|\bevery\s+text\s+item\s+of\b|\(count\s+of\s+\w/,
    scores: { applescript: 11 },
    definitive: 'applescript',
  },
];
