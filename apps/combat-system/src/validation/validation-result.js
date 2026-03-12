"use strict";

/**
 * Build a standard success validation result.
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @returns {object}
 */
function validationSuccess(code, message, details) {
  return {
    ok: true,
    code,
    message,
    details: details || {}
  };
}

/**
 * Build a standard failure validation result.
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @returns {object}
 */
function validationFailure(code, message, details) {
  return {
    ok: false,
    code,
    message,
    details: details || {}
  };
}

module.exports = {
  validationSuccess,
  validationFailure
};
