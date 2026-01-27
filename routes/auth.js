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
} = require('../middlewares/auth');
const { query } = require('../config/database');

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
            return res.status(400).json({
                code: 400,
                message: '用户名、邮箱和密码不能为空',
            });
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
                return res.status(409).json({
                    code: 409,
                    message: '用户名已被占用',
                });
            }
            if (existed.email === email) {
                return res.status(409).json({
                    code: 409,
                    message: '邮箱已被占用',
                });
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

        return res.status(201).json({
            code: 0,
            message: '注册成功',
            data: {
                user: {
                    id: newUserId,
                    username,
                    email,
                    nick_name: nickName || null,
                    avatar_url: avatarUrl || null,
                    role: 'user',
                },
            },
        });
    } catch (err) {
        console.error('POST /api/register error:', err);
        // 唯一约束兜底处理
        if (err && err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                code: 409,
                message: '用户名或邮箱已存在',
            });
        }
        return res.status(500).json({
            code: 500,
            message: '服务器内部错误',
        });
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
            return res.status(400).json({
                code: 400,
                message: '用户名和密码不能为空',
            });
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
            return res.status(401).json({
                code: 401,
                message: '用户名或密码错误',
            });
        }

        // 账号禁用
        if (user.status === 0) {
            return res.status(403).json({
                code: 403,
                message: '账号已被禁用，请联系管理员',
            });
        }

        // 登录失败次数达到上限，视为锁定
        if (user.failed_login_count >= MAX_FAILED_LOGIN) {
            return res.status(403).json({
                code: 403,
                message: '账号已被锁定，请稍后重试或联系管理员',
            });
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

            return res.status(401).json({
                code: 401,
                message: '用户名或密码错误',
            });
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
        return res.json({
            code: 0,
            message: '登录成功',
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                },
            },
        });
    } catch (err) {
        console.error('POST /api/login error:', err);
        return res.status(500).json({
            code: 500,
            message: '服务器内部错误',
        });
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

        return res.json({
            code: 0,
            message: '登出成功',
        });
    } catch (err) {
        console.error('POST /api/logout error:', err);
        // 出于安全考虑，即使出错也返回成功
        return res.json({
            code: 0,
            message: '登出成功',
        });
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
            return res.status(404).json({
                code: 404,
                message: '用户不存在',
            });
        }

        return res.json({
            code: 0,
            message: '获取成功',
            data: {
                user,
            },
        });
    } catch (err) {
        console.error('GET /api/profile error:', err);
        return res.status(500).json({
            code: 500,
            message: '服务器内部错误',
        });
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
    return res.json({
        code: 0,
        message: '欢迎，管理员',
    });
});

module.exports = router;


