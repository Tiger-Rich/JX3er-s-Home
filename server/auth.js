const TOKEN_PATTERN = /^Bearer prototype:([1-9]\d*)$/;

function isValidUserId(userId) {
  return Number.isSafeInteger(userId) && userId > 0;
}

export function hashPassword(password) {
  return `password:${password}`;
}

export function verifyPassword(password, hash) {
  return typeof password === 'string' && hash === hashPassword(password);
}

export function issueToken(userId) {
  if (!isValidUserId(userId)) {
    throw new TypeError('userId must be a positive integer');
  }
  return `prototype:${userId}`;
}

export function parseToken(header) {
  if (typeof header !== 'string') return null;

  const match = TOKEN_PATTERN.exec(header);
  if (!match) return null;

  const userId = Number(match[1]);
  return isValidUserId(userId) ? userId : null;
}

export function loadCurrentUser(db, userId) {
  if (!isValidUserId(userId)) return null;

  return (
    db
      .prepare(
        `SELECT u.id, u.account, u.nickname, u.city, u.contactValue,
                u.role, u.status,
                COALESCE(v.status, 'not_submitted') AS verificationStatus
         FROM users u
         LEFT JOIN verifications v ON v.userId = u.id
         WHERE u.id = ?`,
      )
      .get(userId) ?? null
  );
}

export function requireUser(db) {
  return (req, res, next) => {
    const userId = parseToken(req.get('authorization'));
    const user = loadCurrentUser(db, userId);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    req.user = user;
    return next();
  };
}
