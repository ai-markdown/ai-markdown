import type { DetectionRule } from '../types';

/**
 * Vue / Svelte single-file components.
 * Both are "an HTML shell + script + style" and fire the HTML rules in markup.ts,
 * so the rules here must give html a negative score and tell the two apart by their template directives.
 */
export const sfcRules: DetectionRule[] = [
  // ── Vue ─────────────────────────────────────────────────────────
  {
    id: 'vue-template-block',
    pattern: /^[ \t]*<template>/m,
    scores: { vue: 11, html: -4, svelte: -2 },
    definitive: 'vue',
  },
  {
    id: 'vue-script-setup',
    pattern: /<script\s+setup(?:\s+lang=["'](?:ts|tsx)["'])?\s*>/,
    scores: { vue: 12, html: -4 },
    definitive: 'vue',
  },
  {
    id: 'vue-directive',
    pattern: /\sv-(?:if|else|else-if|for|model|show|bind|on|html|text|slot)\b/,
    scores: { vue: 10, html: -3 },
    definitive: 'vue',
  },
  {
    id: 'vue-shorthand-binding',
    // :prop="x" and @click="x"; take care not to count ordinary HTML attributes as well
    pattern: /\s(?::|@)[\w-]{1,40}=["'][^"'\n]{0,80}["']/,
    scores: { vue: 7, html: -2 },
  },
  {
    id: 'vue-composition-api',
    pattern: /\b(?:defineProps|defineEmits|defineExpose|onMounted|computed|watchEffect)\s*[(<]/,
    scores: { vue: 8 },
  },
  {
    id: 'vue-mustache-in-template',
    pattern: /<[a-z][\w-]{0,30}[^>\n]{0,80}>\s*\{\{\s*[\w.[\]'"]{1,60}\s*\}\}/,
    scores: { vue: 8, html: -2 },
  },

  {
    id: 'sfc-leading-script',
    // Equivalent to \A: without the m flag, ^ only matches the start of the whole snippet.
    // A plain TS/JS file never starts with <script>; an HTML document usually has a doctype or <html> first.
    // Vue and Svelte both write it this way, so the scores are split equally and the template evidence
    // further down decides.
    pattern: /^\s*<script(?:\s[^>\n]{0,80})?>/,
    scores: { vue: 7, svelte: 7, html: 2 },
    // TS inside the script block fires a dozen TS rules, and no negative score can hold that down;
    // but a snippet that starts with a <script> tag structurally cannot be a JS / TS file itself
    excludes: ['javascript', 'typescript', 'jsx', 'tsx'],
  },

  // ── Svelte ──────────────────────────────────────────────────────
  {
    id: 'svelte-logic-block',
    // {#if} {#each} {/if} {:else}: template block syntax unique to Svelte
    // (?<!\{) excludes Handlebars' {{#each}}, whose second brace would otherwise match {#each
    pattern: /(?<!\{)\{[#/:](?:if|each|await|then|catch|else|key|snippet)\b/,
    scores: { svelte: 12, html: -4, vue: -3 },
    definitive: 'svelte',
  },
  {
    id: 'svelte-script-module',
    // <script module> / <script context="module"> is a module script unique to Svelte
    pattern: /<script(?:\s[^>\n]{0,60})?\s(?:module|context=["']module["'])(?:\s[^>\n]{0,40})?>/,
    scores: { svelte: 12, vue: -4, typescript: -6 },
    definitive: 'svelte',
  },
  {
    id: 'svelte-kit-alias',
    // $lib / $app are SvelteKit path aliases; the Vue ecosystem does not use this prefix
    pattern: /from\s+["']\$(?:lib|app)\//,
    scores: { svelte: 10, vue: -3 },
  },
  {
    id: 'svelte-component-imports',
    // A snippet that opens with <script> and imports from svelte, svelte/*, or a .svelte file is a Svelte component.
    // Anchored at the start: a plain .ts module importing svelte/store is TypeScript, not a component.
    pattern:
      /^<script(?:\s[^>\n]{0,80})?>(?:[^\n]{0,300}\n){0,40}?[^\n]{0,300}from\s+["'](?:svelte(?:\/[\w-]{1,30}){0,3}|[^"'\n]{1,200}\.svelte)["']/,
    scores: { svelte: 10, vue: -4 },
  },
  {
    id: 'svelte-reactive-statement',
    pattern: /^[ \t]*\$:\s*[\w{]/m,
    scores: { svelte: 11, javascript: -3 },
    definitive: 'svelte',
  },
  {
    id: 'svelte-export-let',
    pattern: /^[ \t]*export\s+let\s+\w+/m,
    scores: { svelte: 9, javascript: -2, typescript: -2 },
  },
  {
    id: 'svelte-event-directive',
    pattern: /\son(?::|)(?:click|change|input|submit|keydown)=\{/,
    scores: { svelte: 9, html: -2, vue: -2 },
  },
  {
    id: 'svelte-runes',
    pattern: /\$(?:state|derived|effect|props|bindable)\s*\(/,
    scores: { svelte: 11 },
    definitive: 'svelte',
  },
];
