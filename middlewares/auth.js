const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { query } = require('../config/database');

// 读取环境变量中的密钥和配置
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'please_change_access_secret'; // TODO: 请在 .env 中配置安全的随机字符串
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'please_change_refresh_secret'; // TODO: 请在 .env 中配置安全的随机字符串

// Access Token 过期时间（秒），建议 15 分钟
const ACCESS_TOKEN_EXPIRES_IN = parseInt(process.env.ACCESS_TOKEN_EXPIRES_IN || '86400', 10); // 默认1天
// Refresh Token 过期时间（秒），记住登录与普通登录可区分
const REFRESH_TOKEN_EXPIRES_IN = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || '604800', 10); // 默认7天
const REFRESH_TOKEN_EXPIRES_IN_REMEMBER = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_REMEMBER || '2592000', 10); // 默认30天

// 生成随机 Refresh Token 原文
function generateRefreshTokenRaw() {
    return crypto.randomBytes(48).toString('hex');
}

// 计算 Refresh Token 哈希，用于存数据库
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// 生成 Access Token（JWT）
function generateAccessToken(payload) {
    return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
}

// 创建并持久化 Refresh Token，返回原文
async function createAndStoreRefreshToken(user, rememberMe, userAgent, ipAddress) {
    const refreshTokenRaw = generateRefreshTokenRaw();
    const tokenHash = hashToken(refreshTokenRaw);

    const now = new Date();
    const expiresInSeconds = rememberMe ? REFRESH_TOKEN_EXPIRES_IN_REMEMBER : REFRESH_TOKEN_EXPIRES_IN;
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);

    const sql = `
    INSERT INTO user_refresh_tokens
      (user_id, token_hash, remember_me, user_agent, ip_address, expires_at, revoked)
    VALUES
      (?, ?, ?, ?, ?, ?, 0)
  `;

    await query(sql, [
        user.id,
        tokenHash,
        rememberMe ? 1 : 0,
        userAgent || null,
        ipAddress || null,
        expiresAt,
    ]);

    return {
        refreshTokenRaw,
        expiresAt,
    };
}

// 在 Cookie 中设置 Access Token 和 Refresh Token（仅 Cookie 模式）
function setAuthCookies(res, accessToken, refreshTokenRaw, options = {}) {
    const {
        rememberMe = false,
        accessTokenMaxAge = ACCESS_TOKEN_EXPIRES_IN * 1000,
        refreshTokenMaxAge = (rememberMe ? REFRESH_TOKEN_EXPIRES_IN_REMEMBER : REFRESH_TOKEN_EXPIRES_IN) * 1000,
    } = options;

    // 根据环境决定 secure，同域单一前端场景，生产环境建议使用 HTTPS + secure
    const isProduction = process.env.NODE_ENV === 'production';

    // Access Token Cookie（短期）
    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: isProduction, // 生产环境必须 true（需 HTTPS）
        sameSite: 'lax', // 单一域名 + 不跨站表单提交时，一般用 lax；如需跨域再调整
        maxAge: accessTokenMaxAge,
        path: '/',
    });

    // Refresh Token Cookie（长期）
    res.cookie('refresh_token', refreshTokenRaw, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: refreshTokenMaxAge,
        path: '/',
    });
}

// 清理认证相关 Cookie
function clearAuthCookies(res) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
}

// 认证中间件：从 Cookie 中读取 Access Token 并校验
async function authMiddleware(req, res, next) {
    try {
        if (!req.cookies) {
            // 确保应用使用了 cookieParser
            return res.status(401).json({ code: 401, message: '未认证：未找到 Cookie' });
        }

        const token = req.cookies.access_token;

        if (!token) {
            return res.status(401).json({ code: 401, message: '未认证：缺少访问令牌' });
        }

        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
        // 将用户基本信息挂载到 req 对象上
        req.user = {
            id: decoded.sub,
            username: decoded.username,
            role: decoded.role,
        };

        next();
    } catch (err) {
        console.error('authMiddleware error:', err.message);
        return res.status(401).json({ code: 401, message: '未认证或令牌已失效' });
    }
}

// 角色检查中间件：要求用户具有特定角色
function requireRole(requiredRoles) {
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ code: 401, message: '未认证' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ code: 403, message: '无访问权限' });
        }
        next();
    };
}

// 验证并撤销 Refresh Token（用于登出）
async function revokeRefreshToken(refreshTokenRaw) {
    if (!refreshTokenRaw) return;
    const tokenHash = hashToken(refreshTokenRaw);
    const sql = `
    UPDATE user_refresh_tokens
    SET revoked = 1
    WHERE token_hash = ? AND revoked = 0
  `;
    await query(sql, [tokenHash]);
}

module.exports = {
    cookieParser,
    authMiddleware,
    requireRole,
    generateAccessToken,
    createAndStoreRefreshToken,
    setAuthCookies,
    clearAuthCookies,
    revokeRefreshToken,
    hashToken,
};


