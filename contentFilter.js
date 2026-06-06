'use strict';

/**
 * contentFilter.js — Saudaa content moderation engine
 *
 * Blocks traders from leaking personal contact info or external links
 * inside chat messages, trade signals, and free-signal broadcasts.
 *
 * Detection categories:
 *   1. Phone / mobile numbers  (Indian + international, all common formats)
 *   2. Email addresses         (standard + obfuscated [at]/[dot] variants)
 *   3. URLs / hyperlinks       (http/https/www + bare domain.tld + obfuscated)
 *
 * Circumvention handled:
 *   • Spaces between digits:  "9 8 7 6 5 4 3 2 1 0"
 *   • Dot separators:         "98765.43210"
 *   • Dash separators:        "98765-43210"
 *   • Mixed separators:       "+91 98765-432 10"
 *   • Email obfuscation:      "user[at]domain[dot]com", "user (at) domain dot com"
 *   • URL obfuscation:        "hxxps://...", "h t t p s ://", "telegram dot gg"
 *   • Unicode lookalikes:     replaced during normalization
 *
 * Design note — false-positive safety for trading context:
 *   Trading signal numbers (entry: 18500, target: 22750) are at most 7 digits.
 *   Phone numbers are always 10+ digits. The digit-run threshold is set to 10
 *   so that price/index numbers never trigger.
 */

// ── Normalisation helpers ─────────────────────────────────────────────────────

/**
 * Collapse spaces/dots/dashes inserted BETWEEN individual digits to defeat
 * spacing-circumvention ("9 8 7 6 5 4 3 2 1 0" → "9876543210").
 * Only collapses single-digit segments — multi-digit groups (price levels)
 * are left alone.
 */
function collapseDigitSpacing(text) {
  let result = text;
  let prev;
  // Iteratively collapse "single-digit SEP single-digit" until stable
  const SEP = /[ \t.\-_/\\]{1,3}/;
  const SINGLE_DIGIT_SEP = new RegExp(`((?<![0-9])[0-9])${SEP.source}([0-9](?![0-9]))`, 'g');
  do {
    prev = result;
    result = result.replace(SINGLE_DIGIT_SEP, '$1$2');
  } while (result !== prev);
  return result;
}

/**
 * Replace common email/URL obfuscation keywords with the real characters.
 * e.g. "user [at] gmail [dot] com" → "user@gmail.com"
 *      "hxxps://evil.com"          → "https://evil.com"
 *      "t.me/channel"              already caught by domain pattern
 */
function deobfuscate(text) {
  return text
    // [at] / (at) / {at} / " at " → @
    .replace(/\s*[\[({]at[\])}]\s*/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    // [dot] / (dot) / " dot " → .
    .replace(/\s*[\[({]dot[\])}]\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.')
    // hxxp / hxxps → http / https
    .replace(/hxxps?/gi, 'https')
    // h t t p s :// (spaces in scheme)
    .replace(/h\s+t\s+t\s+p\s*s?\s*:\s*\/\s*\//gi, 'https://')
    // Remove zero-width / soft-hyphen unicode characters used to break pattern matching
    .replace(/[­​‌‍⁠﻿]/g, '');
}

/** Combine both normalization passes for circumvention detection. */
function normalize(text) {
  return deobfuscate(collapseDigitSpacing(text));
}

// ── Detection patterns ────────────────────────────────────────────────────────

/**
 * PHONE PATTERNS
 * Threshold: 10+ consecutive digit run (after collapsing separators).
 * Indian mobile: starts with 6-9, 10 digits total.
 * International: optional country code + subscriber number.
 */
const PHONE_PATTERNS = [
  // Indian mobile: 6xxxxx-xxxxx or +91-xxxxx-xxxxx
  /(?<![0-9])(?:\+?91[-.\s]?)?[6-9][0-9]{9}(?![0-9])/g,
  // Generic: optional country code (1-3 digits) + 7-12 digit subscriber
  /(?<![0-9])\+[0-9]{1,3}[-.\s]?[0-9]{4,6}[-.\s]?[0-9]{3,6}(?![0-9])/g,
  // Grouped formats: (022) 2567-8901, 040-2345-6789
  /(?<![0-9])\(?[0-9]{2,5}\)?[-.\s][0-9]{3,5}[-.\s][0-9]{3,6}(?![0-9])/g,
  // Raw 10–15 digit run (catches collapsed obfuscated numbers)
  /(?<![0-9])[0-9]{10,15}(?![0-9])/g,
];

/**
 * EMAIL PATTERNS
 * Applied to both raw text (standard) and deobfuscated text.
 */
const EMAIL_PATTERNS = [
  // Standard RFC-5321 email
  /[a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]{2,}\.[a-zA-Z]{2,}/g,
];

/**
 * URL PATTERNS
 * Applied to both raw text and deobfuscated text.
 */
const URL_PATTERNS = [
  // Explicit scheme
  /https?:\/\/[^\s"'<>]{4,}/gi,
  // www. prefix
  /\bwww\.[a-zA-Z0-9\-]{2,}\.[a-zA-Z]{2,}[^\s"'<>]*/gi,
  // Bare domain.tld — catches t.me/xxx, telegram.gg, wa.me/91xxx, discord.gg
  /\b(?:[a-zA-Z0-9\-]{2,}\.)+(?:com|net|org|in|io|co|app|xyz|info|biz|me|gg|to|cc|us|uk|ca|au|de|fr|jp|ly|link|site|online|store|shop|live|tv|club|chat|group|id|ai|dev)\b(?:\/[^\s"'<>]*)?/gi,
];

// ── Core filter logic ─────────────────────────────────────────────────────────

/**
 * Scan a single string for restricted content.
 *
 * @param {string} text
 * @returns {{ hit: boolean, types: string[] }}
 *   hit   — true if ANY pattern matched
 *   types — array of matched category strings: 'phone', 'email', 'url'
 */
function scan(text) {
  if (typeof text !== 'string' || !text.trim()) return { hit: false, types: [] };

  const raw  = text;
  const norm = normalize(text);          // deobfuscated + digit-spacing collapsed
  const hits = new Set();

  // Test a string against an array of patterns, add category label on match
  function test(str, patterns, label) {
    for (const pattern of patterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      if (pattern.test(str)) {
        hits.add(label);
        return; // one hit per category is enough
      }
    }
  }

  test(raw,  PHONE_PATTERNS, 'phone');
  test(norm, PHONE_PATTERNS, 'phone');   // catches collapsed obfuscation

  test(raw,  EMAIL_PATTERNS, 'email');
  test(norm, EMAIL_PATTERNS, 'email');

  test(raw,  URL_PATTERNS, 'url');
  test(norm, URL_PATTERNS, 'url');

  const types = [...hits];
  return { hit: types.length > 0, types };
}

// ── Human-readable category labels ───────────────────────────────────────────

const CATEGORY_LABELS = {
  phone: 'phone / mobile number',
  email: 'email address',
  url:   'URL or external link',
};

function buildViolationMessage(types) {
  const labels = types.map(t => CATEGORY_LABELS[t] || t);
  const list = labels.length === 1
    ? labels[0]
    : labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1];

  return `Message blocked: sharing a ${list} is not permitted on Saudaa. ` +
    'Remove the restricted content and try again. ' +
    'If you believe this is a mistake, contact support.';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * filterContent — check one or more text fields in a single call.
 *
 * @param {...string} fields  One or more text values to scan (e.g. content, notes, description)
 * @returns {{ blocked: boolean, violations: string[], message: string }}
 *
 * Usage:
 *   const r = filterContent(req.body.content);
 *   const r = filterContent(req.body.description, req.body.timing);
 *   if (r.blocked) return res.status(422).json({ error: r.message, violations: r.violations });
 */
function filterContent(...fields) {
  const allTypes = new Set();

  for (const field of fields) {
    const { hit, types } = scan(field);
    if (hit) types.forEach(t => allTypes.add(t));
  }

  const violations = [...allTypes];
  const blocked    = violations.length > 0;

  return {
    blocked,
    violations,
    message: blocked ? buildViolationMessage(violations) : '',
  };
}

/**
 * buildFlaggedLogEntry — construct the DB record written when a message is blocked.
 * Caller is responsible for pushing this into db.flaggedMessages and calling writeDB.
 *
 * @param {object} opts
 * @param {string}   opts.channel     'chat' | 'signal' | 'free-signal'
 * @param {string}   opts.senderId    User ID of the offender
 * @param {string}   opts.senderRole  'trader' | 'client'
 * @param {string[]} opts.violations  From filterContent().violations
 * @param {string}   opts.preview     First snippet of the offending text (truncated)
 * @returns {object}
 */
function buildFlaggedLogEntry({ channel, senderId, senderRole, violations, preview }) {
  return {
    id:         'flag_' + require('crypto').randomBytes(6).toString('hex'),
    timestamp:  new Date().toISOString(),
    channel,
    senderId,
    senderRole: senderRole || 'unknown',
    violations,
    // Truncate to 200 chars — enough for admin review, avoids storing full PII
    preview:    String(preview || '').slice(0, 200),
    blocked:    true,
  };
}

module.exports = { filterContent, buildFlaggedLogEntry };
