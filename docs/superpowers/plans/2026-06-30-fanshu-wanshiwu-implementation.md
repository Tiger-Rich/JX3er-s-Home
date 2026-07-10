# 番薯万事屋 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable lightweight full-stack Web prototype for 番薯万事屋 with verified user identity, request publishing, contact applications, and admin review workflows.

**Architecture:** A single Node.js workspace serves an Express API and a Vite React frontend. SQLite stores users, profiles, verifications, requests, applications, favorites, and reports. The user app is mobile-first and mini-program-like; the admin area lives at /admin and stays professional.

**Tech Stack:** React, Vite, Node.js, Express, SQLite via better-sqlite3, Vitest, Supertest, React Testing Library, Playwright for final visual smoke checks.

---

## File Structure

Create package.json, index.html, vite.config.js, vitest.config.js, .gitignore, server/schema.sql, server/db.js, server/app.js, server/index.js, server/auth.js, server/domain.js, server/routes/auth.js, server/routes/profile.js, server/routes/requests.js, server/routes/contact.js, server/routes/admin.js, src/main.jsx, src/App.jsx, src/api/client.js, src/domain/constants.js, src/components/AppShell.jsx, src/components/AdminShell.jsx, src/components/StatusBadge.jsx, src/pages/FeedPage.jsx, src/pages/RequestDetailPage.jsx, src/pages/CreateRequestPage.jsx, src/pages/ProfilePage.jsx, src/pages/ContactPage.jsx, src/pages/LoginPage.jsx, src/pages/admin/AdminDashboard.jsx, src/pages/admin/AdminVerifications.jsx, src/pages/admin/AdminRequests.jsx, src/pages/admin/AdminUsers.jsx, src/styles.css, tests/setup.js, tests/domain.test.js, tests/db.test.js, tests/api.identity.test.js, tests/api.requests.test.js, tests/ui.permissions.test.jsx, playwright.config.js, tests/e2e.spec.js.

## Task 1: Initialize Project Shell

**Files:** Create package.json, index.html, vite.config.js, vitest.config.js, .gitignore, tests/setup.js.

- [ ] Step 1: Run git init in D:/codex projects/fanshu0630. Expected: a new .git directory exists.
- [ ] Step 2: Create package.json with scripts dev, api, dev:all, test, test:watch, e2e, build, preview. Dependencies: @vitejs/plugin-react, better-sqlite3, concurrently, cors, express, react, react-dom, vite. Dev dependencies: @playwright/test, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event, jsdom, supertest, vitest.
- [ ] Step 3: Run npm install. Expected: package-lock.json and node_modules are created. If network is blocked, request network permission and rerun npm install.
- [ ] Step 4: Create index.html with root div and script /src/main.jsx.
- [ ] Step 5: Create vite.config.js with React plugin, port 5173, and proxy /api to http://127.0.0.1:8787.
- [ ] Step 6: Create vitest.config.js with jsdom environment, globals true, and setupFiles ./tests/setup.js.
- [ ] Step 7: Create .gitignore containing node_modules/, dist/, .env, *.db, .superpowers/, coverage/, test-results/, playwright-report/.
- [ ] Step 8: Create tests/setup.js importing @testing-library/jest-dom/vitest.
- [ ] Step 9: Run npm test. Expected: Vitest starts successfully and reports no failing tests.
- [ ] Step 10: Commit with message chore: initialize fanshu wanshiwu project.

## Task 2: Domain Constants and Permission Rules

**Files:** Create server/domain.js, src/domain/constants.js, tests/domain.test.js.

- [ ] Step 1: Write tests/domain.test.js to assert unverified, pending, rejected, disabled, and unauthenticated users cannot publish or apply; approved active users can publish and apply; contact values are visible only to applicant or owner after application status approved.
- [ ] Step 2: Run npm test -- tests/domain.test.js. Expected: fail because server/domain.js is missing.
- [ ] Step 3: Create server/domain.js exporting REQUEST_TYPES, VERIFICATION_STATUSES, REQUEST_STATUSES, APPLICATION_STATUSES, isActiveVerifiedUser(user), canPublishRequest(user), canApplyContact(user), canSeeContact(user, application), and isAdmin(user).
- [ ] Step 4: Create src/domain/constants.js exporting requestTypes, verificationLabels, requestStatusLabels, applicationStatusLabels. Labels must include 我的名片, 待掌柜审核, 已确认番薯身份, and must not include 我的番薯名片.
- [ ] Step 5: Run npm test -- tests/domain.test.js. Expected: pass.
- [ ] Step 6: Commit with message feat: define domain statuses and permissions.

## Task 3: SQLite Schema and Seed Data

**Files:** Create server/schema.sql, server/db.js, tests/db.test.js.

- [ ] Step 1: Write tests/db.test.js to create an in-memory database, seed it, and assert these tables exist: users, profiles, verifications, requests, contact_applications, favorites, reports.
- [ ] Step 2: Run npm test -- tests/db.test.js. Expected: fail because server/db.js is missing.
- [ ] Step 3: Create server/schema.sql with tables matching the design spec. Use status checks for user role, user status, verification status, request status, application status, report target type, and report status.
- [ ] Step 4: Create server/db.js exporting createDatabase(filename) and seedDatabase(db). createDatabase must enable foreign_keys and execute schema.sql. seedDatabase must create admin/admin123, qixiu/test123, wanhua/test123, approved profiles, approved verifications, and one approved 求职内推 or 行业咨询 request.
- [ ] Step 5: Run npm test -- tests/db.test.js. Expected: pass.
- [ ] Step 6: Commit with message feat: add sqlite schema and seed data.

## Task 4: Auth, Profile, and Verification API

**Files:** Create server/auth.js, server/app.js, server/index.js, server/routes/auth.js, server/routes/profile.js, tests/api.identity.test.js.

- [ ] Step 1: Write tests/api.identity.test.js with Supertest cases for register, login, get current user, profile fetch, verification submission blocked without 区服 and 游戏 ID/昵称, and successful verification submission setting status pending.
- [ ] Step 2: Run npm test -- tests/api.identity.test.js. Expected: fail because app and routes are missing.
- [ ] Step 3: Create server/auth.js with hashPassword(password), verifyPassword(password, hash), issueToken(userId), parseToken(header), loadCurrentUser(db, userId), and requireUser(db) middleware. Prototype hashing may use password: prefix because this is local MVP only.
- [ ] Step 4: Create server/routes/auth.js exposing POST /register, POST /login, GET /me. Register must create users, profiles, and verifications rows with verification status not_submitted.
- [ ] Step 5: Create server/routes/profile.js exposing GET / and POST /verification. POST /verification must require server and gameNickname and must update user, profile, and verification status pending.
- [ ] Step 6: Create server/app.js mounting /api/auth and /api/profile and /api/health.
- [ ] Step 7: Create server/index.js that opens fanshu.db, seeds it, and listens on 127.0.0.1:8787.
- [ ] Step 8: Run npm test -- tests/api.identity.test.js. Expected: pass.
- [ ] Step 9: Commit with message feat: add identity and verification api.

## Task 5: Request, Contact, Favorite, Report, and Admin API

**Files:** Modify server/app.js. Create server/routes/requests.js, server/routes/contact.js, server/routes/admin.js, tests/api.requests.test.js.

- [ ] Step 1: Write tests/api.requests.test.js covering full workflow: verified owner publishes request, admin approves request, public feed shows it without contact value, verified applicant applies, owner approves, applicant can then see owner contact.
- [ ] Step 2: Add tests that unverified users cannot publish or apply, rejected requests do not appear in feed, and taken_down requests do not appear in feed.
- [ ] Step 3: Run npm test -- tests/api.requests.test.js. Expected: fail because routes are missing.
- [ ] Step 4: Create server/routes/requests.js with GET /, GET /:id, POST /, POST /:id/favorite, POST /:id/report, POST /:id/applications. Enforce approved verification for POST / and application creation.
- [ ] Step 5: Create server/routes/contact.js with GET /, GET /:id, POST /:id/approve, POST /:id/reject. Only the request owner can approve or reject. Contact value is returned only when canSeeContact returns true.
- [ ] Step 6: Create server/routes/admin.js with GET /verifications, POST /verifications/:userId/approve, POST /verifications/:userId/reject, GET /requests, POST /requests/:id/approve, POST /requests/:id/reject, POST /requests/:id/takedown, GET /users, POST /users/:id/disable. Reject and takedown endpoints must require non-empty reason.
- [ ] Step 7: Mount /api/requests, /api/contact, and /api/admin in server/app.js.
- [ ] Step 8: Run npm test -- tests/api.requests.test.js tests/api.identity.test.js tests/domain.test.js tests/db.test.js. Expected: pass.
- [ ] Step 9: Commit with message feat: add request contact and admin api.

## Task 6: React Shell, Session Flow, and API Client

**Files:** Create src/main.jsx, src/App.jsx, src/api/client.js, src/components/AppShell.jsx, src/components/AdminShell.jsx, src/components/StatusBadge.jsx, src/pages/LoginPage.jsx, tests/ui.permissions.test.jsx.

- [ ] Step 1: Write tests/ui.permissions.test.jsx asserting bottom nav includes 万事广场, 发个委托, 联系申请, 我的名片; the text 我的番薯名片 is absent; the text 匿名 is absent from shell navigation.
- [ ] Step 2: Run npm test -- tests/ui.permissions.test.jsx. Expected: fail because components are missing.
- [ ] Step 3: Create src/api/client.js with getToken, setToken, and api(path, options) using fetch, JSON, and Bearer token.
- [ ] Step 4: Create AppShell.jsx with header 番薯万事屋, subtitle 同在江湖，先看身份，再谈合作。, and four bottom nav buttons.
- [ ] Step 5: Create AdminShell.jsx with professional admin labels only: 认证审核, 委托审核, 用户列表.
- [ ] Step 6: Create StatusBadge.jsx mapping statuses to readable labels from src/domain/constants.js.
- [ ] Step 7: Create LoginPage.jsx with login/register mode, account, password, nickname for register, and error display.
- [ ] Step 8: Create App.jsx bootstrapping GET /api/auth/me, rendering LoginPage when logged out, AdminShell for admin users, and AppShell for normal users.
- [ ] Step 9: Create src/main.jsx rendering App and importing src/styles.css.
- [ ] Step 10: Run npm test -- tests/ui.permissions.test.jsx. Expected: pass.
- [ ] Step 11: Commit with message feat: add react shell and session flow.

## Task 7: User Workflow Pages

**Files:** Create src/pages/FeedPage.jsx, src/pages/RequestDetailPage.jsx, src/pages/CreateRequestPage.jsx, src/pages/ProfilePage.jsx, src/pages/ContactPage.jsx. Modify src/App.jsx and tests/ui.permissions.test.jsx.

- [ ] Step 1: Extend UI tests to assert 委托详情 hides contact values before approval, CreateRequestPage shows the boundary copy, and ProfilePage requires 区服 and 游戏 ID/昵称.
- [ ] Step 2: Run npm test -- tests/ui.permissions.test.jsx. Expected: fail because pages are missing.
- [ ] Step 3: Implement FeedPage.jsx fetching GET /api/requests, sorting 求职内推 and 行业咨询 first, and filtering by type, city, industry, remote.
- [ ] Step 4: Implement RequestDetailPage.jsx fetching GET /api/requests/:id, rendering public owner identity only, posting contact applications, and offering favorite/report actions.
- [ ] Step 5: Implement CreateRequestPage.jsx with required type, title, description, city or remote, expiresAt, optional budgetOrReward, disabled submit for non-approved verification, and no anonymous control.
- [ ] Step 6: Implement ProfilePage.jsx fetching GET /api/profile, editing 我的名片, and submitting verification with required server and gameNickname.
- [ ] Step 7: Implement ContactPage.jsx listing outgoing and incoming applications and approving/rejecting incoming applications. Render contact values only for approved applications.
- [ ] Step 8: Wire pages into App.jsx and preserve page state when navigating by bottom tabs.
- [ ] Step 9: Run npm test -- tests/ui.permissions.test.jsx. Expected: pass.
- [ ] Step 10: Commit with message feat: add user workflow pages.

## Task 8: Admin Review Interface

**Files:** Create src/pages/admin/AdminDashboard.jsx, src/pages/admin/AdminVerifications.jsx, src/pages/admin/AdminRequests.jsx, src/pages/admin/AdminUsers.jsx. Modify src/App.jsx and tests/ui.permissions.test.jsx.

- [ ] Step 1: Extend UI tests to assert admin interface shows 认证审核, 委托审核, 用户列表 and does not show 待掌柜审核 as an admin tab.
- [ ] Step 2: Run npm test -- tests/ui.permissions.test.jsx. Expected: fail because admin pages are missing.
- [ ] Step 3: Implement AdminDashboard.jsx with tabs and summary counts from admin endpoints.
- [ ] Step 4: Implement AdminVerifications.jsx with pending verification list, support material display, approve button, reject reason input, and reject button disabled until reason is non-empty.
- [ ] Step 5: Implement AdminRequests.jsx with request filters and approve/reject/takedown operations. Reject and takedown require reason.
- [ ] Step 6: Implement AdminUsers.jsx with filters by nickname, server, city, industry, verification status, user status, and a disable action.
- [ ] Step 7: Wire admin pages into App.jsx for admin role.
- [ ] Step 8: Run npm test -- tests/ui.permissions.test.jsx. Expected: pass.
- [ ] Step 9: Commit with message feat: add admin review interface.

## Task 9: Styling, Copy Review, and Responsive Polish

**Files:** Create src/styles.css. Modify component class names when needed.

- [ ] Step 1: Create src/styles.css with mobile-first app width max 480px, fixed bottom nav, 8px cards, readable forms, warm neutral background, restrained accent colors, and desktop admin layout.
- [ ] Step 2: Apply classes to user pages and admin pages so mobile forms do not overflow at 360px width.
- [ ] Step 3: Run rg "我的番薯名片|匿名发布|账号密码|账号交易|代练|外挂|私服|担保" src server tests docs. Expected: 我的番薯名片 and 匿名发布 are absent; risk terms appear only in boundary copy, tests, or docs; 账号密码 appears only in privacy explanation that says not to request it.
- [ ] Step 4: Run npm test and npm run build. Expected: both pass.
- [ ] Step 5: Commit with message style: polish interface and copy.

## Task 10: End-to-End Smoke Test and Delivery

**Files:** Create playwright.config.js, tests/e2e.spec.js. Modify package.json if scripts need adjustment.

- [ ] Step 1: Create playwright.config.js with two web servers: npm run api at http://127.0.0.1:8787/api/health and npm run dev at http://127.0.0.1:5173.
- [ ] Step 2: Create tests/e2e.spec.js asserting the app loads, 番薯万事屋 is visible, 万事广场 and 我的名片 are visible, 我的番薯名片 is absent, and 匿名 is absent from the initial UI.
- [ ] Step 3: Run npm run e2e. Expected: pass.
- [ ] Step 4: Manually inspect http://127.0.0.1:5173 at 390px and 1280px widths. Verify no overlap, bottom navigation fits, admin tables are readable, and the core flow is understandable.
- [ ] Step 5: Run npm test, npm run build, and npm run e2e. Expected: all pass.
- [ ] Step 6: Commit with message test: add end to end smoke coverage.

## Spec Coverage Checklist

- 我的名片 naming: Tasks 6, 7, 10.
- Required 区服 and 游戏 ID/昵称 certification: Tasks 4, 7.
- No anonymous publishing: Tasks 2, 6, 7, 9, 10.
- Contact hidden until approval: Tasks 2, 5, 7.
- Approved-only feed and filters: Tasks 5, 7.
- Admin certification and request review: Tasks 5, 8.
- User disable and takedown: Tasks 5, 8.
- Risk boundaries: Tasks 7, 9.
- Mobile user app and desktop admin: Tasks 6, 8, 9, 10.