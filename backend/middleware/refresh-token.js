const cookieParser = require('cookie-parser');

module.exports = function (req, res, next) {
  const refreshToken = req.cookies?.refresh_token;
  req.refreshToken = refreshToken || null;
  next();
};
