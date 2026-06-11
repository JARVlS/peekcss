import {
  colorDistance,
  composite,
  contrastRatio,
  CVD_TYPES,
  formatRgba,
  isLargeText,
  parseColor,
  type RGBA,
  simulateCvd,
} from '@/utils/color';
import type {
  AccessibilityReport,
  ColorBlindConflict,
  ContrastIssue,
} from '@/utils/messages';

// Resolves the effective (opaque) background behind an element by compositing
// its own and ancestors' background colors, falling back to white.
export function effectiveBackground(el: Element): RGBA {
  const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
  let node: Element | null = el;
  let result: RGBA | null = null;
  while (node) {
    const bg = parseColor(window.getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0) {
      result = result ? composite(result, bg) : bg;
      if (result.a >= 0.999) return result;
    }
    node = node.parentElement;
  }
  return result ? composite(result, white) : white;
}

// Returns only the element's own (direct) text, trimmed and whitespace-collapsed.
function directText(el: Element): string {
  let s = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) s += node.textContent ?? '';
  }
  return s.replace(/\s+/g, ' ').trim();
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList).slice(0, 2);
  return cls.length ? `${tag}.${cls.join('.')}` : tag;
}

function gradeFor(score: number): { grade: string; rating: string } {
  if (score >= 90) return { grade: 'A', rating: 'Excellent' };
  if (score >= 80) return { grade: 'B', rating: 'Good' };
  if (score >= 70) return { grade: 'C', rating: 'Fair' };
  if (score >= 60) return { grade: 'D', rating: 'Poor' };
  return { grade: 'F', rating: 'Critical' };
}

// Flags pairs of prominent colors that are clearly distinct to normal vision
// but collapse together under a simulated color-vision deficiency.
function analyzeColorBlind(colorStrs: string[]): AccessibilityReport['colorBlind'] {
  const colors = colorStrs
    .map((s) => parseColor(s))
    .filter((c): c is RGBA => !!c && c.a > 0.5);

  const DISTINCT = 80;
  const COLLAPSE = 28;

  let checkedPairs = 0;
  const conflicts: ColorBlindConflict[] = [];

  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i];
      const b = colors[j];
      if (colorDistance(a, b) < DISTINCT) continue;
      checkedPairs++;
      for (const type of CVD_TYPES) {
        if (colorDistance(simulateCvd(a, type), simulateCvd(b, type)) < COLLAPSE) {
          conflicts.push({ a: formatRgba(a, 'rgb'), b: formatRgba(b, 'rgb'), type });
          break;
        }
      }
    }
  }

  const score = checkedPairs ? Math.round((1 - conflicts.length / checkedPairs) * 100) : 100;
  return { score, checkedPairs, conflicts: conflicts.slice(0, 8) };
}

// Audits the page for accessibility: WCAG AA text contrast, tiny text, and a
// color-blind-safe palette. `prominentColors` are the page's most-used colors.
export function auditAccessibility(prominentColors: string[]): AccessibilityReport {
  const all = document.querySelectorAll('body *');
  const limit = Math.min(all.length, 4000);

  let checked = 0;
  let passed = 0;
  let smallCount = 0;
  let smallestPx = Infinity;
  const issues: ContrastIssue[] = [];

  for (let i = 0; i < limit; i++) {
    const el = all[i];
    const sample = directText(el);
    if (!sample) continue;

    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || (parseFloat(cs.opacity) || 1) === 0) {
      continue;
    }

    const fontSize = parseFloat(cs.fontSize) || 16;
    const fontWeight = parseInt(cs.fontWeight, 10) || 400;
    const large = isLargeText(fontSize, fontWeight);

    const text = parseColor(cs.color);
    if (!text || text.a === 0) continue;

    if (fontSize < smallestPx) smallestPx = fontSize;
    if (fontSize < 12) smallCount++;

    const bg = effectiveBackground(el);
    const fgOnBg = composite(text, bg);
    const ratio = contrastRatio(fgOnBg, bg);
    const required = large ? 3 : 4.5;

    checked++;
    if (ratio >= required) {
      passed++;
    } else {
      issues.push({
        selector: describe(el),
        ratio: Math.round(ratio * 100) / 100,
        required,
        textColor: formatRgba(fgOnBg, 'rgb'),
        bgColor: formatRgba(bg, 'rgb'),
        fontSize: Math.round(fontSize),
        largeText: large,
        sample: sample.slice(0, 60),
      });
    }
  }

  issues.sort((a, b) => a.ratio - b.ratio);
  const failed = checked - passed;
  const contrastScore = checked ? Math.round((passed / checked) * 100) : 100;
  const textSizeScore = checked ? Math.round(((checked - smallCount) / checked) * 100) : 100;
  const colorBlind = analyzeColorBlind(prominentColors);

  const score = Math.round(contrastScore * 0.55 + textSizeScore * 0.2 + colorBlind.score * 0.25);
  const { grade, rating } = gradeFor(score);

  return {
    score,
    grade,
    rating,
    contrast: { score: contrastScore, checked, passed, failed, issues: issues.slice(0, 30) },
    textSize: {
      score: textSizeScore,
      checked,
      smallCount,
      smallestPx: smallestPx === Infinity ? 0 : Math.round(smallestPx),
    },
    colorBlind,
  };
}
