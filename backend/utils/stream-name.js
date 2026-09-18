const MAX_STREAM_NAME_LENGTH = 128;
const FORBIDDEN_STREAM_NAME_CHARS = /[\u0000-\u001f\u007f/\\?#%]/u;

function isValidStreamName(value) {
  const name = String(value ?? '');
  return name.length > 0
    && name.length <= MAX_STREAM_NAME_LENGTH
    && name === name.trim()
    && name !== '.'
    && name !== '..'
    && !FORBIDDEN_STREAM_NAME_CHARS.test(name);
}

function assertValidStreamName(value) {
  if (!isValidStreamName(value)) throw new Error('Invalid stream name');
  return String(value);
}

module.exports = { MAX_STREAM_NAME_LENGTH, isValidStreamName, assertValidStreamName };
