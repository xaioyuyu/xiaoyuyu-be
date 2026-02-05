const express = require('express');
const bcrypt = require('bcrypt');
const {
    generateAccessToken,
    createAndStoreRefreshToken,
    setAuthCookies,
    clearAuthCookies,
    revokeRefreshToken,
    authMiddleware,
    requireRole,
    hashToken,
} = require('../middlewares/auth');
const { query } = require('../config/database');
const { success, fail, httpError, MESSAGE_CODES } = require('../utils/response');

const router = express.Router();

// 登录失败最大次数
const MAX_FAILED_LOGIN = 5;

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: 用户认证与授权相关接口
 */

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: 用户注册
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: 用户名（唯一）
 *               email:
 *                 type: string
 *                 format: email
 *                 description: 邮箱（唯一）
 *               password:
 *                 type: string
 *                 format: password
 *                 description: 登录密码
 *               nickName:
 *                 type: string
 *                 description: 昵称（可选）
 *               avatarUrl:
 *                 type: string
 *                 description: 头像地址（可选）
 *           example:
 *             username: test_user
 *             email: test@example.com
 *             password: P@ssw0rd
 *             nickName: 测试用户
 *             avatarUrl: https://example.com/avatar.png
 *     responses:
 *       201:
 *         description: 注册成功
 *       400:
 *         description: 参数错误
 *       409:
 *         description: 用户名或邮箱已存在
 *       500:
 *         description: 服务器内部错误
 */
// 注册接口 POST /api/register
router.post('/register', async (req, res) => {
    try {
        const { username, email, password, nickName, avatarUrl } = req.body || {};

        if (!username || !email || !password) {
            return fail(res, MESSAGE_CODES.USERNAME_OR_EMAIL_REQUIRED);
        }

        // 检查用户名或邮箱是否已存在
        const existedUsers = await query(
            `
      SELECT id, username, email
      FROM users
      WHERE (username = ? OR email = ?) AND is_deleted = 0
      LIMIT 1
    `,
            [username, email],
        );

        if (existedUsers[0]) {
            const existed = existedUsers[0];
            if (existed.username === username) {
                return fail(res, MESSAGE_CODES.USERNAME_EXISTS);
            }
            if (existed.email === email) {
                return fail(res, MESSAGE_CODES.EMAIL_EXISTS);
            }
        }

        // 加密密码
        const passwordHash = await bcrypt.hash(password, 10);

        // 写入数据库，默认角色 user、状态正常、未删除
        const result = await query(
            `
      INSERT INTO users
        (username, email, password_hash, nick_name, avatar_url, role, status, failed_login_count, is_deleted, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, 'user', 1, 0, 0, NOW(), NOW())
    `,
            [username, email, passwordHash, nickName || null, avatarUrl || null],
        );

        const newUserId = result.insertId;

        return success(
            res,
            MESSAGE_CODES.REGISTER_SUCCESS,
            {
                user: {
                    id: newUserId,
                    username,
                    email,
                    nick_name: nickName || null,
                    avatar_url: avatarUrl || null,
                    role: 'user',
                },
            },
        );
    } catch (err) {
        console.error('POST /api/register error:', err);
        // 唯一约束兜底处理
        if (err && err.code === 'ER_DUP_ENTRY') {
            return fail(res, MESSAGE_CODES.USERNAME_OR_EMAIL_EXISTS);
        }
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: 用户登录
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: 用户名
 *               password:
 *                 type: string
 *                 format: password
 *                 description: 登录密码
 *               rememberMe:
 *                 type: boolean
 *                 description: 记住登录（使用更长时间的 Refresh Token）
 *           example:
 *             username: test_user
 *             password: P@ssw0rd
 *             rememberMe: true
 *     responses:
 *       200:
 *         description: 登录成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 用户名或密码错误
 *       403:
 *         description: 账号被禁用或锁定
 *       500:
 *         description: 服务器内部错误
 */
// 登录接口 POST /api/login
router.post('/login', async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body || {};

        if (!username || !password) {
            return fail(res, MESSAGE_CODES.PASSWORD_REQUIRED);
        }

        // 查询用户（只支持用户名登录），排除软删除用户
        const users = await query(
            `
      SELECT id, username, email, password_hash, role, status, failed_login_count, is_deleted
      FROM users
      WHERE username = ? LIMIT 1
    `,
            [username],
        );

        const user = users[0];

        // 用户不存在或被软删除
        if (!user || user.is_deleted) {
            // 出于安全考虑，不暴露用户是否存在
            return fail(res, MESSAGE_CODES.USERNAME_OR_PASSWORD_ERROR);
        }

        // 账号禁用
        if (user.status === 0) {
            return fail(res, MESSAGE_CODES.ACCOUNT_DISABLED);
        }

        // 登录失败次数达到上限，视为锁定
        if (user.failed_login_count >= MAX_FAILED_LOGIN) {
            return fail(res, MESSAGE_CODES.ACCOUNT_LOCKED);
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            // 密码错误，增加失败次数
            await query(
                `
        UPDATE users
        SET failed_login_count = failed_login_count + 1
        WHERE id = ?
      `,
                [user.id],
            );

            return fail(res, MESSAGE_CODES.USERNAME_OR_PASSWORD_ERROR);
        }

        // 登录成功：重置失败次数，更新 last_login_at
        await query(
            `
      UPDATE users
      SET failed_login_count = 0,
          last_login_at = NOW()
      WHERE id = ?
    `,
            [user.id],
        );

        const payload = {
            sub: user.id,
            username: user.username,
            role: user.role,
        };

        const accessToken = generateAccessToken(payload);

        const userAgent = req.headers['user-agent'] || '';
        const ipAddress =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.connection?.remoteAddress ||
            req.ip ||
            null;

        const remember = !!rememberMe;

        const { refreshTokenRaw } = await createAndStoreRefreshToken(
            { id: user.id },
            remember,
            userAgent,
            ipAddress,
        );

        // 设置 Cookie（仅 Cookie 模式）
        setAuthCookies(res, accessToken, refreshTokenRaw, {
            rememberMe: remember,
        });

        // 返回用户基础信息，Access Token 不需要在 body 中返回
        return success(
            res,
            MESSAGE_CODES.LOGIN_SUCCESS,
            {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                },
            },
        );
    } catch (err) {
        console.error('POST /api/login error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/logout:
 *   post:
 *     summary: 用户登出
 *     tags: [Auth]
 *     description: 清除 Cookie 中的访问令牌和刷新令牌
 *     responses:
 *       200:
 *         description: 登出成功
 */
// 登出接口 POST /api/logout
router.post('/logout', async (req, res) => {
    try {
        const refreshTokenRaw = req.cookies?.refresh_token;

        // 无论是否存在，均尝试撤销并清除 Cookie，防止暴露 token 状态
        if (refreshTokenRaw) {
            await revokeRefreshToken(refreshTokenRaw);
        }

        clearAuthCookies(res);

        return success(res, MESSAGE_CODES.LOGOUT_SUCCESS);
    } catch (err) {
        console.error('POST /api/logout error:', err);
        // 出于安全考虑，即使出错也返回成功
        return success(res, MESSAGE_CODES.LOGOUT_SUCCESS);
    }
});

/**
 * @swagger
 * /api/refresh-token:
 *   post:
 *     summary: 使用 Refresh Token 刷新 Access Token
 *     description: |
 *       从 HttpOnly Cookie 中读取 refresh_token，校验未过期且未撤销后，签发新的访问令牌（access_token）写入 Cookie。
 *       不返回 token 字符串，仅通过 Cookie 续期。前端收到 200 即视为刷新成功。
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 刷新成功
 *       401:
 *         description: 未认证或刷新令牌无效
 *       500:
 *         description: 服务器内部错误
 */
router.post('/refresh-token', async (req, res) => {
    try {
        const refreshTokenRaw = req.cookies?.refresh_token;

        if (!refreshTokenRaw) {
            return httpError(res, 401, MESSAGE_CODES.UNAUTHORIZED, null, '未认证：缺少刷新令牌');
        }

        const tokenHash = hashToken(refreshTokenRaw);

        const rows = await query(
            `
      SELECT
        urt.user_id,
        urt.remember_me,
        urt.expires_at,
        urt.revoked,
        u.username,
        u.role
      FROM user_refresh_tokens urt
      JOIN users u ON urt.user_id = u.id
      WHERE urt.token_hash = ?
      LIMIT 1
    `,
            [tokenHash],
        );

        const record = rows[0];

        if (!record || record.revoked) {
            clearAuthCookies(res);
            return httpError(res, 401, MESSAGE_CODES.UNAUTHORIZED, null, '未认证或刷新令牌无效');
        }

        const now = new Date();
        const expiresAt = new Date(record.expires_at);
        if (expiresAt <= now) {
            clearAuthCookies(res);
            return httpError(res, 401, MESSAGE_CODES.UNAUTHORIZED, null, '刷新令牌已过期');
        }

        const payload = {
            sub: record.user_id,
            username: record.username,
            role: record.role,
        };

        const newAccessToken = generateAccessToken(payload);

        // 只需刷新 access_token，refresh_token 原样保留在 Cookie 和数据库中
        setAuthCookies(res, newAccessToken, refreshTokenRaw, {
            rememberMe: !!record.remember_me,
        });

        return success(res, MESSAGE_CODES.SUCCESS);
    } catch (err) {
        console.error('POST /api/refresh-token error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/profile:
 *   get:
 *     summary: 获取当前登录用户信息
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: 获取成功
 *       401:
 *         description: 未认证
 *       404:
 *         description: 用户不存在
 *       500:
 *         description: 服务器内部错误
 */
// 一个示例受保护接口，包含角色判断（例如只允许 admin 访问）
router.get('/profile', authMiddleware, async (req, res) => {
    // console.log('GET /api/profile', req);
    try {
        const users = await query(
            `
      SELECT id, username, email, nick_name, avatar_url, role
      FROM users
      WHERE id = ? AND is_deleted = 0
      LIMIT 1
    `,
            [req.user.id],
        );

        const user = users[0];

        if (!user) {
            return fail(res, MESSAGE_CODES.USER_NOT_FOUND);
        }

        return success(
            res,
            MESSAGE_CODES.GET_SUCCESS,
            {
                user,
            },
        );
    } catch (err) {
        console.error('GET /api/profile error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/profile/update:
 *   post:
 *     summary: 修改当前登录用户的个人信息
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: 用户名（唯一，可选）
 *                 example: "new_username"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: 邮箱（唯一，可选）
 *                 example: "newemail@example.com"
 *               nickName:
 *                 type: string
 *                 description: 昵称（可选）
 *                 example: "新昵称"
 *               avatarUrl:
 *                 type: string
 *                 description: 头像URL（可选）
 *                 example: "https://example.com/avatar.jpg"
 *     responses:
 *       200:
 *         description: 修改成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 message:
 *                   type: string
 *                   example: "修改成功"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         username:
 *                           type: string
 *                         email:
 *                           type: string
 *                         nick_name:
 *                           type: string
 *                         avatar_url:
 *                           type: string
 *                         role:
 *                           type: string
 *       400:
 *         description: 请求参数错误（如邮箱格式不正确）
 *       401:
 *         description: 未认证
 *       404:
 *         description: 用户不存在
 *       409:
 *         description: 数据冲突（用户名或邮箱已被占用）
 *       500:
 *         description: 服务器内部错误
 */
// 修改个人信息接口 POST /api/profile/update
router.post('/profile/update', authMiddleware, async (req, res) => {
    try {
        const { username, email, nickName, avatarUrl } = req.body || {};
        const userId = req.user.id;

        // 验证至少提供了一个要修改的字段
        if (!username && !email && nickName === undefined && avatarUrl === undefined) {
            return fail(res, MESSAGE_CODES.NO_FIELDS_TO_UPDATE);
        }

        // 验证邮箱格式（如果提供了邮箱）
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return fail(res, MESSAGE_CODES.INVALID_EMAIL_FORMAT);
            }
        }

        // 验证用户名格式（如果提供了用户名）
        if (username) {
            // 用户名长度限制：3-50个字符
            if (username.length < 3 || username.length > 50) {
                return fail(res, MESSAGE_CODES.USERNAME_LENGTH_INVALID);
            }
            // 用户名只能包含字母、数字、下划线
            const usernameRegex = /^[a-zA-Z0-9_]+$/;
            if (!usernameRegex.test(username)) {
                return fail(res, MESSAGE_CODES.INVALID_USERNAME_FORMAT);
            }
        }

        // 先查询当前用户是否存在且未被删除
        const currentUsers = await query(
            `
      SELECT id, username, email, nick_name, avatar_url, role, is_deleted
      FROM users
      WHERE id = ? LIMIT 1
    `,
            [userId],
        );

        const currentUser = currentUsers[0];

        if (!currentUser || currentUser.is_deleted) {
            return fail(res, MESSAGE_CODES.USER_NOT_FOUND);
        }

        // 检查用户名唯一性（如果提供了新用户名，且与当前用户名不同）
        if (username && username !== currentUser.username) {
            const existedUsers = await query(
                `
        SELECT id, username
        FROM users
        WHERE username = ? AND id != ? AND is_deleted = 0
        LIMIT 1
      `,
                [username, userId],
            );

            if (existedUsers[0]) {
                return fail(res, MESSAGE_CODES.USERNAME_EXISTS);
            }
        }

        // 检查邮箱唯一性（如果提供了新邮箱，且与当前邮箱不同）
        if (email && email !== currentUser.email) {
            const existedUsers = await query(
                `
        SELECT id, email
        FROM users
        WHERE email = ? AND id != ? AND is_deleted = 0
        LIMIT 1
      `,
                [email, userId],
            );

            if (existedUsers[0]) {
                return fail(res, MESSAGE_CODES.EMAIL_EXISTS);
            }
        }

        // 构建更新SQL，只更新提供的字段
        const updateFields = [];
        const updateValues = [];

        if (username) {
            updateFields.push('username = ?');
            updateValues.push(username);
        }
        if (email) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (nickName !== undefined) {
            updateFields.push('nick_name = ?');
            updateValues.push(nickName || null);
        }
        if (avatarUrl !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatarUrl || null);
        }

        // 添加 updated_at
        updateFields.push('updated_at = NOW()');
        updateValues.push(userId);

        // 执行更新
        await query(
            `
      UPDATE users
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `,
            updateValues,
        );

        // 查询更新后的用户信息
        const updatedUsers = await query(
            `
      SELECT id, username, email, nick_name, avatar_url, role
      FROM users
      WHERE id = ? AND is_deleted = 0
      LIMIT 1
    `,
            [userId],
        );

        const updatedUser = updatedUsers[0];

        if (!updatedUser) {
            return fail(res, MESSAGE_CODES.USER_NOT_FOUND);
        }

        return success(
            res,
            MESSAGE_CODES.UPDATE_SUCCESS,
            {
                user: updatedUser,
            },
        );
    } catch (err) {
        console.error('POST /api/profile/update error:', err);
        // 处理唯一约束冲突
        if (err && err.code === 'ER_DUP_ENTRY') {
            return fail(res, MESSAGE_CODES.USERNAME_OR_EMAIL_EXISTS);
        }
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/admin-only:
 *   get:
 *     summary: 仅管理员可访问的接口
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: 访问成功
 *       401:
 *         description: 未认证
 *       403:
 *         description: 无访问权限
 */
// 示例：仅 admin 角色可访问的接口
router.get('/admin-only', authMiddleware, requireRole('admin'), (req, res) => {
    return success(res, MESSAGE_CODES.SUCCESS, null, '欢迎，管理员');
});

module.exports = router;


