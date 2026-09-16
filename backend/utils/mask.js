function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.substring(0, 8) + '****' + key.substring(key.length - 4);
}

module.exports = { maskKey };
