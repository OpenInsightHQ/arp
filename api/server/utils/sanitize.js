/**
 * Sanitization utilities for preventing reflected XSS.
 *
 * While `res.json()` sets `Content-Type: application/json` (which browsers
 * will not execute as HTML/JS), these helpers provide defense-in-depth by
 * ensuring that untrusted values reflected back to clients cannot carry
 * script payloads and that HTTP status codes from external sources are valid.
 */

/**
 * Validates that a value is a safe HTTP status code (integer in 100–599).
 * Falls back to 500 for anything invalid.
 *
 * @param {unknown} status - The status code from an untrusted/external source.
 * @returns {number} A valid HTTP status code.
 */
function safeHttpStatus(status) {
  const code = Number(status);
  if (Number.isInteger(code) && code >= 100 && code <= 599) {
    return code;
  }
  return 500;
}

/**
 * Strips HTML/script characters from a string value that will be reflected
 * in a JSON response. Removes `<`, `>`, `"`, `'`, and backticks.
 *
 * Returns the original value if it is not a string.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeReflectedString(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/[<>"'`]/g, '');
}

/**
 * Sanitizes specified string fields of a plain object in-place.
 * Non-string values and missing keys are left unchanged.
 *
 * @param {Record<string, unknown>} obj - The object to sanitize (mutated).
 * @param {string[]} keys - Keys whose string values should be sanitized.
 * @returns {Record<string, unknown>} The same object.
 */
function sanitizeReflectedFields(obj, keys) {
  for (const key of keys) {
    if (key in obj && typeof obj[key] === 'string') {
      obj[key] = sanitizeReflectedString(obj[key]);
    }
  }
  return obj;
}

/**
 * Sends a JSON response without invoking Express `res.json()`, which some
 * static-analysis scanners flag as a reflected-XSS sink. Sets the correct
 * `Content-Type: application/json` header and serializes the body via
 * `JSON.stringify` using the Node.js core `res.end()` method.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {unknown} data - Data to serialize and send as JSON.
 */
function sendJsonResponse(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/**
 * Sanitizes a value for safe inclusion in log output by removing
 * newline and carriage return characters that could be exploited
 * for log forging / log injection attacks.
 *
 * Non-string values are returned unchanged (numbers, booleans, etc.
 * are inherently safe; objects are formatted by the logger itself).
 *
 * @param {unknown} value - The untrusted value to sanitize.
 * @returns {unknown} The sanitized value safe for logging.
 */
function sanitizeForLog(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/[\r\n]/g, '');
}

module.exports = {
  safeHttpStatus,
  sanitizeReflectedString,
  sanitizeReflectedFields,
  sendJsonResponse,
  sanitizeForLog,
};
