import type { LanguageId } from '../language';

export interface DetectionFixture {
  name: string;
  code: string;
  /** The language the detector should name; null means it should say it does not know */
  expected: LanguageId | null;
  /** When expected is null, the candidates must fall inside this set (subset relation) */
  acceptableCandidates?: LanguageId[];
  /** When expected is not null, the minimum confidence required */
  minConfidence?: number;
  /** When expected is null, the confidence must stay below this */
  maxConfidence?: number;
}

/** Clean positive samples for each language */
export const positives: DetectionFixture[] = [
  {
    name: 'python-function',
    expected: 'python',
    minConfidence: 0.8,
    code: `def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)


if __name__ == "__main__":
    print(fibonacci(10))`,
  },
  {
    name: 'typescript-interface',
    expected: 'typescript',
    minConfidence: 0.8,
    code: `interface User {
  id: string
  email: string
  age?: number
}

export function greet(user: User): string {
  return \`hello \${user.email}\`
}`,
  },
  {
    name: 'javascript-commonjs',
    expected: 'javascript',
    minConfidence: 0.8,
    code: `const fs = require('fs')

function readConfig(path) {
  const raw = fs.readFileSync(path, 'utf8')
  return JSON.parse(raw)
}

module.exports = { readConfig }`,
  },
  {
    name: 'rust-struct-impl',
    expected: 'rust',
    minConfidence: 0.8,
    code: `use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Counter {
    counts: HashMap<String, usize>,
}

impl Counter {
    pub fn add(&mut self, key: &str) {
        let mut entry = self.counts.entry(key.to_string()).or_insert(0);
        *entry += 1;
    }
}`,
  },
  {
    name: 'go-http-handler',
    expected: 'go',
    minConfidence: 0.8,
    code: `package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "hello")
	})
	if err := http.ListenAndServe(":8080", nil); err != nil {
		panic(err)
	}
}`,
  },
  {
    name: 'bash-script',
    expected: 'bash',
    minConfidence: 0.8,
    code: `#!/usr/bin/env bash
set -euo pipefail

for f in "$@"; do
  if [[ -f "$f" ]]; then
    gzip -9 -c "$f" > "\${f}.gz"
  fi
done`,
  },
  {
    name: 'java-main',
    expected: 'java',
    minConfidence: 0.8,
    code: `package com.example.demo;

import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> names = List.of("a", "b");
        System.out.println(names.size());
    }
}`,
  },
  {
    name: 'csharp-console',
    expected: 'csharp',
    minConfidence: 0.8,
    code: `using System;
using System.Collections.Generic;

namespace Demo
{
    public class Program
    {
        public string Name { get; set; }

        static void Main(string[] args)
        {
            Console.WriteLine("hello");
        }
    }
}`,
  },
  {
    name: 'cpp-vector',
    expected: 'cpp',
    minConfidence: 0.8,
    code: `#include <iostream>
#include <vector>

int main() {
    std::vector<int> values = {3, 1, 2};
    for (const auto& v : values) {
        std::cout << v << std::endl;
    }
    return 0;
}`,
  },
  {
    name: 'c-malloc',
    expected: 'c',
    minConfidence: 0.8,
    code: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    char *buf = malloc(256);
    if (buf == NULL) {
        return 1;
    }
    strncpy(buf, "hello", 5);
    printf("%s\\n", buf);
    free(buf);
    return 0;
}`,
  },
  {
    name: 'sql-select',
    expected: 'sql',
    minConfidence: 0.8,
    code: `SELECT u.id, u.email, count(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at >= '2026-01-01'
GROUP BY u.id, u.email
ORDER BY orders DESC
LIMIT 50;`,
  },
  {
    name: 'json-object',
    expected: 'json',
    minConfidence: 0.9,
    code: `{
  "name": "demo",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "shiki": "^3.22.0" }
}`,
  },
  {
    name: 'html-page',
    expected: 'html',
    minConfidence: 0.8,
    code: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Demo</title>
  </head>
  <body>
    <div class="wrap"><p>hello</p></div>
  </body>
</html>`,
  },
  {
    name: 'css-rules',
    expected: 'css',
    minConfidence: 0.8,
    code: `.card {
  display: grid;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 10px;
  background: #161a21;
}

@media (max-width: 600px) {
  .card { padding: 12px; }
}`,
  },
  {
    name: 'jsx-component',
    expected: 'jsx',
    minConfidence: 0.8,
    code: `import React, { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div className="counter">
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  )
}`,
  },
  {
    name: 'tsx-typed-component',
    expected: 'tsx',
    minConfidence: 0.8,
    code: `import { useState } from 'react'

interface Props {
  initial: number
}

export function Counter({ initial }: Props) {
  const [count, setCount] = useState<number>(initial)
  return <div className="c"><button onClick={() => setCount(count + 1)}>+</button></div>
}`,
  },
  {
    name: 'yaml-compose',
    expected: 'yaml',
    minConfidence: 0.8,
    code: `version: "3.9"
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    ports:
      - "8080:8080"
    environment:
      LOG_LEVEL: debug`,
  },
  {
    name: 'xml-library',
    expected: 'xml',
    minConfidence: 0.8,
    code: `<?xml version="1.0" encoding="UTF-8"?>
<library>
  <album id="a01">
    <title>Morning Sketches</title>
  </album>
</library>`,
  },
  {
    name: 'scss-mixin',
    expected: 'scss',
    minConfidence: 0.8,
    code: `$primary: #161a21;

@mixin card($pad: 16px) {
  padding: $pad;
  border-radius: 8px;
}

.card {
  @include card;
  &:hover { opacity: 0.8; }
}`,
  },
  {
    name: 'kotlin-data-class',
    expected: 'kotlin',
    minConfidence: 0.8,
    code: `data class User(val id: String, val email: String)

fun main() {
    val user = User("1", "a@b.c")
    println(user.email)
}`,
  },
  {
    name: 'swift-guard-let',
    expected: 'swift',
    minConfidence: 0.8,
    code: `import Foundation

func greet(name: String?) -> String {
    guard let name = name else {
        return "hello"
    }
    return "hello (name)"
}`,
  },
  {
    name: 'dart-flutter-widget',
    expected: 'dart',
    minConfidence: 0.8,
    code: `import 'package:flutter/material.dart';

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return const Text('hi');
  }
}`,
  },
  {
    name: 'php-class',
    expected: 'php',
    minConfidence: 0.8,
    code: `<?php

namespace App\\Http;

class Controller
{
    public function index()
    {
        echo $this->render();
    }
}`,
  },
  {
    name: 'ruby-block',
    expected: 'ruby',
    minConfidence: 0.8,
    code: `require 'json'

def parse(path)
  File.readlines(path).map do |line|
    JSON.parse(line)
  end
end

puts parse('a.jsonl').size`,
  },
  {
    name: 'lua-module',
    expected: 'lua',
    minConfidence: 0.8,
    code: `local M = {}

function M.sum(list)
  local total = 0
  for _, v in ipairs(list) do
    total = total + v
  end
  return total
end

return M`,
  },
  {
    name: 'powershell-pipeline',
    expected: 'powershell',
    minConfidence: 0.8,
    code: `param(
  [string]$Path
)

Get-ChildItem -Path $Path -Recurse |
  Where-Object { $_.Length -gt 1MB } |
  Select-Object Name, Length`,
  },
  {
    name: 'toml-cargo',
    expected: 'toml',
    minConfidence: 0.8,
    code: `[package]
name = "demo"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }`,
  },
  {
    name: 'ini-with-semicolon-comment',
    expected: 'ini',
    minConfidence: 0.8,
    code: `[server]
host = 127.0.0.1
port = 8080
; 日志相关
[log]
level = info`,
  },
  {
    name: 'less-variables',
    expected: 'less',
    minConfidence: 0.8,
    code: `@primary: #161a21;
@radius: 8px;

.card {
  background: @primary;
  border-radius: @radius;
  .shadow();
}`,
  },
  {
    name: 'vue-sfc',
    expected: 'vue',
    minConfidence: 0.8,
    code: `<template>
  <div class="counter">
    <button @click="inc">{{ count }}</button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
const count = ref(0)
function inc() { count.value += 1 }
</script>`,
  },
  {
    name: 'svelte-component',
    expected: 'svelte',
    minConfidence: 0.8,
    code: `<script>
  export let initial = 0
  let count = initial
  $: doubled = count * 2
</script>

{#if count > 0}
  <p>{doubled}</p>
{/if}`,
  },
  {
    name: 'groovy-gradle',
    expected: 'groovy',
    minConfidence: 0.8,
    code: `plugins {
    id 'java'
}

dependencies {
    implementation 'org.springframework:spring-core:6.1.0'
    testImplementation 'junit:junit:4.13'
}`,
  },
  {
    name: 'scala-case-class',
    expected: 'scala',
    minConfidence: 0.8,
    code: `import scala.concurrent.Future

case class User(id: String, email: String)

object Main extends App {
  def find(id: String): Option[User] = None
}`,
  },
  {
    name: 'objective-c-class',
    expected: 'objective-c',
    minConfidence: 0.8,
    code: `#import <Foundation/Foundation.h>

@interface Counter : NSObject
@property (nonatomic) NSInteger count;
- (void)increment;
@end

@implementation Counter
- (void)increment {
    self.count += 1;
}
@end`,
  },
  {
    name: 'zig-main',
    expected: 'zig',
    minConfidence: 0.8,
    code: `const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("hello\\n", .{});
}`,
  },
  {
    name: 'vb-module',
    expected: 'vb',
    minConfidence: 0.8,
    code: `Imports System

Module Program
    Sub Main(args As String())
        Dim name As String = "world"
        Console.WriteLine(name)
    End Sub
End Module`,
  },
  {
    name: 'matlab-function',
    expected: 'matlab',
    minConfidence: 0.8,
    code: `function [m, s] = stats(x)
%STATS 计算均值与标准差
    m = mean(x);
    s = std(x);
    y = x .* 2;
    disp(numel(y));
end`,
  },
  {
    name: 'julia-struct',
    expected: 'julia',
    minConfidence: 0.8,
    code: `using Statistics

struct Point
    x::Float64
    y::Float64
end

function dist(p::Point)
    sqrt(p.x^2 + p.y^2)
end

@time dist(Point(3.0, 4.0))`,
  },
  {
    name: 'asm-linux-syscall',
    expected: 'asm',
    minConfidence: 0.8,
    code: `section .text
    global _start

_start:
    mov rax, 1
    mov rdi, 1
    syscall
    ret`,
  },
  {
    name: 'applescript-tell',
    expected: 'applescript',
    minConfidence: 0.8,
    code: `tell application "Finder"
    set folderCount to count of folders
    display dialog "共 " & folderCount & " 个文件夹"
end tell`,
  },
];

/** Ambiguous samples: the evidence cannot settle a language, so the correct behaviour is a candidate list */
export const ambiguous: DetectionFixture[] = [
  {
    name: 'plain-js-function-could-be-ts',
    expected: null,
    acceptableCandidates: ['javascript', 'typescript'],
    maxConfidence: 0.8,
    code: `function add(a, b) {
  return a + b
}`,
  },
  {
    name: 'const-arrow-no-types',
    expected: null,
    acceptableCandidates: ['javascript', 'typescript'],
    maxConfidence: 0.8,
    code: `const foo = () => 1`,
  },
  {
    name: 'annotated-const-is-ts',
    expected: 'typescript',
    minConfidence: 0.8,
    code: `const foo: number = 1
const bar: string = "x"
let items: string[] = []`,
  },
  {
    name: 'unquoted-keys-not-json',
    // Valid JS / JSON5 / YAML-ish: not enough evidence to settle a language, and above all it must not be json
    expected: null,
    maxConfidence: 0.8,
    code: `{
  foo: 1
}`,
  },
  {
    name: 'bare-include-is-c-or-cpp',
    expected: null,
    acceptableCandidates: ['c', 'cpp'],
    maxConfidence: 0.8,
    code: `#include <stdio.h>

int main() {}`,
  },
  {
    name: 'generic-xml-tags',
    expected: null,
    acceptableCandidates: ['xml', 'html', 'jsx', 'tsx'],
    maxConfidence: 0.8,
    code: `<foo>
  <bar>baz</bar>
</foo>`,
  },
  {
    name: 'drizzle-query-builder-not-sql',
    // `select().from()` is a JS query builder, not an SQL statement
    expected: null,
    acceptableCandidates: ['javascript', 'typescript'],
    maxConfidence: 0.8,
    code: `const rows = await db.select().from(users).where(eq(users.id, 1))`,
  },
  {
    name: 'set-cookie-header-not-powershell',
    expected: null,
    acceptableCandidates: ['javascript', 'typescript'],
    maxConfidence: 0.8,
    code: `const cookie = req.headers['Set-Cookie']
res.setHeader('Set-Cookie', cookie)`,
  },
  {
    name: 'venv-activate-not-applescript',
    // A trailing activate is only AppleScript when it stands on a line of its own
    expected: null,
    maxConfidence: 0.8,
    code: `python -m venv venv
source venv/bin/activate
pip install -r requirements.txt`,
  },
  {
    name: 'c-two-int-decls-not-asm',
    // Two consecutive `int x = …` lines are not the assembly int interrupt instruction
    expected: null,
    acceptableCandidates: ['c', 'cpp'],
    maxConfidence: 0.8,
    code: `int main(void) {
    int a = 1;
    int b = 2;
    return a + b;
}`,
  },
  {
    name: 'python-typing-list-not-scala',
    expected: null,
    acceptableCandidates: ['python', 'scala'],
    maxConfidence: 0.8,
    code: `names: List[str] = []
ages: Dict[str, int] = {}`,
  },
  {
    name: 'markdown-bullet-parens-not-objc',
    // `- (Optional) …` is not an Objective-C method declaration
    expected: null,
    maxConfidence: 0.8,
    code: `- (Optional) Add tests
- (Required) Update docs`,
  },
];

/** The groups most likely to steal each other's scores once new languages were added; each must stay correct */
export const newLanguageConfusions: DetectionFixture[] = [
  {
    name: 'scss-not-less',
    expected: 'scss',
    minConfidence: 0.8,
    code: `$primary: #161a21;

@mixin card { padding: 16px; }

.card {
  @include card;
  &:hover { opacity: 0.8; }
}`,
  },
  {
    name: 'plain-css-with-media-not-less',
    // @media is a CSS at-rule and must not be taken for a Less @variable
    expected: 'css',
    minConfidence: 0.8,
    code: `.card {
  display: grid;
  gap: 12px;
  padding: 16px;
}

@media (max-width: 600px) {
  .card { padding: 8px; }
}`,
  },
  {
    name: 'plain-html-not-vue',
    expected: 'html',
    minConfidence: 0.8,
    code: `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>Demo</title></head>
  <body>
    <div class="wrap"><p>hello</p></div>
  </body>
</html>`,
  },
  {
    name: 'java-not-groovy-or-scala',
    expected: 'java',
    minConfidence: 0.8,
    code: `package com.example.demo;

import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> names = List.of("a", "b");
        System.out.println(names.size());
    }
}`,
  },
  {
    name: 'kotlin-not-scala',
    expected: 'kotlin',
    minConfidence: 0.8,
    code: `package com.example

data class User(val id: String, val email: String)

fun main() {
    val user = User("1", "a@b.c")
    println(user.email)
}`,
  },
  {
    name: 'c-not-objective-c',
    expected: 'c',
    minConfidence: 0.8,
    code: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    char *buf = malloc(256);
    strncpy(buf, "hello", 5);
    printf("%s\n", buf);
    free(buf);
    return 0;
}`,
  },
  {
    name: 'rust-not-zig',
    expected: 'rust',
    minConfidence: 0.8,
    code: `use std::collections::HashMap;

pub fn tally(words: &[&str]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for w in words {
        *counts.entry(w.to_string()).or_insert(0) += 1;
    }
    counts
}`,
  },
  {
    name: 'lua-not-vb',
    // Lowercase if ... then / end is everyday Lua and must not be taken by the VB rules
    expected: 'lua',
    minConfidence: 0.8,
    code: `local M = {}

function M.sum(list)
  local total = 0
  for _, v in ipairs(list) do
    total = total + v
  end
  if total > 0 then
    return total
  end
end

return M`,
  },
  {
    name: 'react-select-import-not-sql',
    // `import { Select, … } from '…'` used to match SELECT … FROM and was detected as sql at 0.95
    expected: 'jsx',
    minConfidence: 0.8,
    code: `import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

export function Toolbar({ value, onChange }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
      </SelectContent>
    </Select>
  )
}`,
  },
  {
    name: 'sql-two-lines-not-dockerfile',
    // A bare `FROM users` used to be taken for a Dockerfile FROM instruction
    expected: 'sql',
    minConfidence: 0.8,
    code: `SELECT *
FROM users`,
  },
  {
    name: 'rust-use-std-not-cpp',
    // `std::` also fires the definitive C++ rule; the negative cpp score from `use std::` pushes it back down
    expected: 'rust',
    minConfidence: 0.8,
    code: `use std::collections::HashMap;
use std::io;`,
  },
  {
    name: 'swift-struct-not-typescript',
    // Capitalised type annotations are split equally between TS / Swift; init( and Int32 are Swift-only evidence
    expected: 'swift',
    minConfidence: 0.8,
    code: `public enum ToastPresentation {
    public static let maxVisibleCount = 3

    public struct Anchor: Equatable, Sendable {
        public let screenIndex: Int32
        public let offsetY: UInt32

        public init(screenIndex: Int32, offsetY: UInt32) {
            self.screenIndex = screenIndex
            self.offsetY = offsetY
        }
    }
}`,
  },
  {
    name: 'kotlin-class-not-typescript',
    expected: 'kotlin',
    minConfidence: 0.8,
    code: `import android.content.Context
import android.location.LocationManager

class TripTracker(context: Context) {
    private val INTERVAL_MS = 5000
    private lateinit var locationManager: LocationManager
}`,
  },
  {
    name: 'python-dict-literal-not-json',
    // A dict literal with quoted keys has the same shape as JSON; the assignment at the start of the line tells
    // them apart. The only Python evidence here is one import line, so not naming python is correct, but it must
    // never be json
    expected: null,
    code: `import json

ICONS = {"alpha": "a", "beta": "b"}
TASK_LABELS = {
    "t-1": "Sortable table of orders",
    "t-2": "Invoice list with total, due date, state",
}`,
  },
  {
    name: 'python-script-with-dict-literal',
    expected: 'python',
    minConfidence: 0.8,
    code: `#!/usr/bin/env python3
import json

ICONS = {"alpha": "a", "beta": "b"}
TASK_LABELS = {
    "t-1": "Sortable table of orders",
    "t-2": "Invoice list with total, due date, state",
}`,
  },
  {
    name: 'js-object-quoted-keys-not-json',
    // The only JS evidence is const and module.exports: enough to outrank json but not to settle a language;
    // both are among the candidates
    expected: null,
    acceptableCandidates: ['javascript', 'typescript', 'json'],
    maxConfidence: 0.8,
    code: `const config = {
  "name": "demo",
  "version": "1.0.0",
  "private": true
}
module.exports = config`,
  },
  {
    name: 'powershell-script-not-kotlin-or-php',
    expected: 'powershell',
    minConfidence: 0.8,
    code: `$ErrorActionPreference = "Stop"

function Test-ValueMatch($Actual, $Expected, [string]$Name) {
  if ($Actual -ne $Expected) {
    throw "$Name should be '$Expected' but was '$Actual'"
  }
}`,
  },
  {
    name: 'eigen-cpp-not-julia',
    // `Eigen::Matrix<…>` used to match Julia's `::Matrix` type annotation
    expected: 'cpp',
    minConfidence: 0.8,
    code: `#include <Eigen/Dense>
#include <iostream>

int main() {
    Eigen::Matrix<double, 3, 3> m = Eigen::Matrix<double, 3, 3>::Zero();
    std::cout << m << std::endl;
    return 0;
}`,
  },
  {
    name: 'python-embedded-sql-string-not-sql',
    expected: 'python',
    minConfidence: 0.8,
    code: `def get_users(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM users WHERE active = 1")
    return cur.fetchall()`,
  },
];

/** Negative samples: natural language, command-line fragments and the like must lean towards unknown */
export const negatives: DetectionFixture[] = [
  { name: 'hello-world-text', expected: null, maxConfidence: 0.5, code: 'hello world' },
  { name: 'foo-bar-baz', expected: null, maxConfidence: 0.5, code: 'foo bar baz' },
  { name: 'simple-assignment', expected: null, maxConfidence: 0.5, code: 'a = b + c' },
  { name: 'arithmetic', expected: null, maxConfidence: 0.5, code: '1 + 2' },
  { name: 'http-line', expected: null, maxConfidence: 0.5, code: 'GET /foo' },
  {
    name: 'chinese-prose',
    expected: null,
    maxConfidence: 0.5,
    code: '昨天下午三点，工程师在机房里发现散热风扇停转了。她把备用件换上，顺手记了一条工单。',
  },
  {
    name: 'english-prose',
    expected: null,
    maxConfidence: 0.5,
    code: `The detector should stay quiet when the input is ordinary prose.
It is better to return nothing than to guess a programming language here.`,
  },
];

export const allFixtures = [...positives, ...newLanguageConfusions, ...ambiguous, ...negatives];
