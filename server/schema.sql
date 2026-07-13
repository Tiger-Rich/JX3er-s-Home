CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  city TEXT,
  contactValue TEXT,
  contactVisibleAfterApproval INTEGER NOT NULL DEFAULT 0
    CHECK (contactVisibleAfterApproval IN (0, 1)),
  role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  openid TEXT UNIQUE,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  server TEXT,
  gameNickname TEXT,
  sect TEXT,
  startedYear INTEGER,
  industry TEXT,
  occupation TEXT,
  canOffer TEXT,
  lookingFor TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (status IN ('not_submitted', 'pending', 'approved', 'rejected')),
  supportMaterial TEXT,
  reviewerId INTEGER,
  reviewedAt TEXT,
  rejectReason TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewerId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId INTEGER NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN (
      'job_referral',
      'industry_consulting',
      'trade',
      'commission',
      'local_help',
      'other'
    )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  city TEXT,
  remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1)),
  industry TEXT,
  budgetOrReward TEXT,
  expiresAt TEXT NOT NULL CHECK (datetime(expiresAt) IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'pending',
      'approved',
      'rejected',
      'taken_down',
      'expired'
    )),
  rejectReason TEXT,
  takedownReason TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, ownerId),
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestId INTEGER NOT NULL,
  url TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  sizeBytes INTEGER NOT NULL,
  sortOrder INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contact_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestId INTEGER NOT NULL,
  applicantId INTEGER NOT NULL,
  ownerId INTEGER NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  handledAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (requestId, applicantId),
  CHECK (applicantId <> ownerId),
  FOREIGN KEY (requestId, ownerId)
    REFERENCES requests(id, ownerId) ON DELETE CASCADE,
  FOREIGN KEY (applicantId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  requestId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (userId, requestId),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  requestId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (userId, requestId),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporterId INTEGER NOT NULL,
  targetType TEXT NOT NULL
    CHECK (targetType IN ('request', 'user', 'contact_application')),
  targetId INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'dismissed')),
  handlerId INTEGER,
  handledAt TEXT,
  resultNote TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporterId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (handlerId) REFERENCES users(id) ON DELETE SET NULL
);
