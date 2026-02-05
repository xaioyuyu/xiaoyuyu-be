const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/auth');
const { query } = require('../config/database');
const { success, fail, httpError, MESSAGE_CODES } = require('../utils/response');

// 所有标签接口均需要登录
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Tags
 *   description: 标签相关接口
 */

/**
 * @swagger
 * /api/tags:
 *   get:
 *     summary: 获取标签列表
 *     tags: [Tags]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: 获取成功
 *       401:
 *         description: 未认证
 *       500:
 *         description: 服务器内部错误
 */
router.get('/tags', async (req, res) => {
    try {
        const userId = req.user.id;

        const rows = await query(
            `
      SELECT id, user_id, name, color, is_system
      FROM fs_tags
      WHERE is_deleted = 0 AND (user_id IS NULL OR user_id = ?)
      ORDER BY id ASC
    `,
            [userId],
        );

        return success(res, MESSAGE_CODES.GET_SUCCESS, { list: rows });
    } catch (err) {
        console.error('GET /api/tags error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/tags:
 *   post:
 *     summary: 创建标签
 *     tags: [Tags]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: 标签名称
 *               color:
 *                 type: string
 *                 description: 颜色HEX（可选）
 *           example:
 *             name: 工作
 *             color: "#1890FF"
 *     responses:
 *       200:
 *         description: 创建成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       500:
 *         description: 服务器内部错误
 */
router.post('/tags', async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, color, is_system } = req.body || {};

        if (!name) {
            return fail(res, MESSAGE_CODES.TAG_REQUIRED_FIELDS);
        }

        try {
            const result = await query(
                `
        INSERT INTO fs_tags
          (user_id, name, color, is_system, is_deleted, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, 0, NOW(), NOW())
      `,
                [userId, name, color || null, is_system || 0],
            );

            const id = result.insertId;
            return success(res, MESSAGE_CODES.SUCCESS, { id });
        } catch (err) {
            console.error('POST /api/tags error:', err);
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
        }
    } catch (err) {
        console.error('POST /api/tags outer error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/tags/delete:
 *   delete:
 *     summary: 删除标签（软删除，标签ID通过 body 传入）
 *     tags: [Tags]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: 标签ID
 *     responses:
 *       200:
 *         description: 删除成功
 *       401:
 *         description: 未认证
 *       404:
 *         description: 标签不存在
 *       500:
 *         description: 服务器内部错误
 */
router.delete('/tags/delete', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.body || {};
        const tagId = Number(id);

        if (!tagId) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const rows = await query(
            `
      SELECT id, user_id, is_system, is_deleted
      FROM fs_tags
      WHERE id = ? AND is_deleted = 0
      LIMIT 1
    `,
            [tagId],
        );
        const tag = rows[0];

        if (!tag || (tag.user_id && tag.user_id !== userId)) {
            return fail(res, MESSAGE_CODES.TAG_NOT_FOUND);
        }

        await query(
            `
      UPDATE fs_tags
      SET is_deleted = 1, updated_at = NOW()
      WHERE id = ?
    `,
            [tagId],
        );

        return success(res, MESSAGE_CODES.SUCCESS);
    } catch (err) {
        console.error('DELETE /api/tags/:id error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

module.exports = router;



