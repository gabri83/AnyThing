#!/usr/bin/env node
/**
 * Guard the device build against the Car Thing's browser.
 *
 * The Car Thing runs a Chromium 69-era engine: the stock image is QtWebEngine
 * 5.12.7 (Chromium 69.0.3497), and the custom images still target it. The
 * failure mode is not a slightly wrong layout — optional chaining and nullish
 * coalescing both arrived in Chrome 80, so one of them anywhere in the bundle
 * is a syntax error and a blank screen with nothing in the host log to explain
 * it.
 *
 * So this checks two things after a build:
 *
 *   1. every emitted JS file parses as ES2019
 *   2. the device stylesheet uses no CSS newer than Chrome 69
 *
 * The settings stylesheet is exempt: that page is only ever opened on the Mac.
 *
 * Run with `npm run check:device`.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Highest ECMAScript version Chromium 69 parses without choking. */
const MAX_ECMA_VERSION = 2019;

/** CSS features that do not exist in Chromium 69, with the version that added them. */
const CSS_BLOCKLIST = [
  { pattern: /color-mix\s*\(/, feature: 'color-mix()', since: 'Chrome 111' },
  { pattern: /(^|[\s;{])aspect-ratio\s*:/, feature: 'aspect-ratio', since: 'Chrome 88' },
  { pattern: /(^|[\s;{])inset\s*:/, feature: 'the inset shorthand', since: 'Chrome 87' },
  { pattern: /(^|[\s;{])accent-color\s*:/, feature: 'accent-color', since: 'Chrome 93' },
  { pattern: /:is\s*\(/, feature: ':is()', since: 'Chrome 88' },
  { pattern: /:where\s*\(/, feature: ':where()', since: 'Chrome 88' },
  { pattern: /(^|[\s:(])clamp\s*\(/, feature: 'clamp()', since: 'Chrome 79' },
  { pattern: /(^|[\s;{])backdrop-filter\s*:/, feature: 'backdrop-filter', since: 'Chrome 76' },
  { pattern: /(^|[\s;{])content-visibility\s*:/, feature: 'content-visibility', since: 'Chrome 85' },
  { pattern: /\bdvh\b|\bsvh\b|\blvh\b/, feature: 'dynamic viewport units', since: 'Chrome 108' }
];

const problems = [];

/** Strip comments so a note *about* a feature is not mistaken for using it. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Split a stylesheet into { selector, body } for each rule. */
function rules(css) {
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    found.push({ selector: match[1].trim(), body: match[2] });
  }
  return found;
}

function checkCss(path, label) {
  if (!existsSync(path)) {
    problems.push(`${label}: not found at ${path}`);
    return;
  }

  const css = stripComments(readFileSync(path, 'utf8'));

  for (const { pattern, feature, since } of CSS_BLOCKLIST) {
    if (pattern.test(css)) {
      problems.push(`${label}: uses ${feature}, which needs ${since}`);
    }
  }

  // `gap` works in grid on Chrome 69 but not in flex, where it is silently
  // ignored and everything ends up touching.
  for (const rule of rules(css)) {
    const isFlex = /display\s*:\s*(inline-)?flex/.test(rule.body);
    const hasGap = /(^|[\s;{])(gap|row-gap|column-gap)\s*:/.test(rule.body);
    if (isFlex && hasGap) {
      problems.push(
        `${label}: "${rule.selector}" sets gap on a flex container, ` +
          'which needs Chrome 84 — use grid, or margins'
      );
    }
  }
}

function checkJs(dir) {
  if (!existsSync(dir)) {
    problems.push(`No build output at ${dir} — run "npm run build" first`);
    return;
  }

  let acorn;
  try {
    acorn = require('acorn');
  } catch {
    problems.push('acorn is not installed, so the JS syntax check cannot run');
    return;
  }

  const files = readdirSync(dir).filter((name) => name.endsWith('.js'));
  if (files.length === 0) {
    problems.push(`No JS emitted into ${dir}`);
    return;
  }

  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    try {
      acorn.parse(source, { ecmaVersion: MAX_ECMA_VERSION, sourceType: 'module' });
    } catch (error) {
      problems.push(
        `${file} does not parse as ES${MAX_ECMA_VERSION}: ${error.message}. ` +
          "Check the Vite build target is 'chrome69'."
      );
    }
  }
}

checkJs(join(root, 'ui', 'dist', 'assets'));
checkCss(join(root, 'ui', 'src', 'styles.css'), 'styles.css');

if (problems.length > 0) {
  console.error('Device compatibility check failed:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nThe Car Thing runs a Chromium 69-era engine. See docs/DEVICE.md.'
  );
  process.exit(1);
}

console.log(
  `Device compatibility OK: bundle parses as ES${MAX_ECMA_VERSION}, ` +
    'device stylesheet is Chromium 69 safe.'
);
