function setHttpOnlyCookie(res, name, value, maxAgeSeconds) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: maxAgeSeconds * 1000
  });
}

module.exports = { setHttpOnlyCookie };
