const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/auth');
const { query } = require('../config/database');
const { success, fail, httpError, MESSAGE_CODES } = require('../utils/response');

// 所有分类接口均需要登录
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Categories
 *   description: 记账分类相关接口
 */

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: 获取分类列表
 *     tags: [Categories]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: type_id
 *         schema:
 *           type: integer
 *         description: 记账类型ID
 *     responses:
 *       200:
 *         description: 获取成功
 *       401:
 *         description: 未认证
 *       500:
 *         description: 服务器内部错误
 */
router.get('/categories', async (req, res) => {
    try {
        const userId = req.user.id;
        const { type_id } = req.query || {};

        const params = [];
        let whereClauses = ['is_deleted = 0'];

        if (type_id) {
            whereClauses.push('type_id = ?');
            params.push(Number(type_id));
        }

        // 系统预置 + 当前用户
        whereClauses.push('(user_id IS NULL OR user_id = ?)');
        params.push(userId);

        const rows = await query(
            `
      SELECT id, user_id, type_id, name, parent_id, icon, color, sort_order, is_system
      FROM fs_categories
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY sort_order ASC, id ASC
    `,
            params,
        );

        return success(res, MESSAGE_CODES.GET_SUCCESS, { list: rows });
    } catch (err) {
        console.error('GET /api/categories error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: 创建分类
 *     tags: [Categories]
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
 *               - type_id
 *             properties:
 *               name:
 *                 type: string
 *                 description: 分类名称
 *               type_id:
 *                 type: integer
 *                 description: 记账类型ID
 *               parent_id:
 *                 type: integer
 *                 nullable: true
 *                 description: 父级分类ID
 *               icon:
 *                 type: string
 *                 description: 图标
 *               color:
 *                 type: string
 *                 description: 颜色HEX
 *               sort_order:
 *                 type: integer
 *                 description: 排序值
 *           example:
 *             name: 餐饮
 *             type_id: 1
 *             parent_id: null
 *             icon: "🍔"
 *             color: "#FF9900"
 *             sort_order: 1
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
router.post('/categories', async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, type_id, parent_id, icon, color, sort_order, is_system } = req.body || {};

        if (!name || !type_id) {
            return fail(res, MESSAGE_CODES.CATEGORY_REQUIRED_FIELDS);
        }

        try {
            const result = await query(
                `
        INSERT INTO fs_categories
          (user_id, type_id, name, parent_id, icon, color, sort_order, is_system, is_deleted, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
      `,
                [userId, type_id, name, parent_id || null, icon || null, color || null, sort_order || 0, is_system || 0],
            );

            const id = result.insertId;
            return success(res, MESSAGE_CODES.SUCCESS, { id });
        } catch (err) {
            console.error('POST /api/categories error:', err);
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
        }
    } catch (err) {
        console.error('POST /api/categories outer error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/categories/update:
 *   put:
 *     summary: 修改分类（通过 body 传入分类ID，避免在URL中暴露）
 *     tags: [Categories]
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
 *                 description: 分类ID
 *               name:
 *                 type: string
 *               parent_id:
 *                 type: integer
 *                 nullable: true
 *               icon:
 *                 type: string
 *               color:
 *                 type: string
 *               sort_order:
 *                 type: integer
 *     responses:
 *       200:
 *         description: 修改成功
 *       401:
 *         description: 未认证
 *       404:
 *         description: 分类不存在
 *       500:
 *         description: 服务器内部错误
 */
router.put('/categories/update', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, name, parent_id, icon, color, sort_order, is_system = 0 } = req.body || {};
        const categoryId = Number(id);

        if (!categoryId) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        // 只能修改当前用户的自定义分类或系统分类（可根据业务限制）
        const rows = await query(
            `
      SELECT id, user_id, is_system, is_deleted
      FROM fs_categories
      WHERE id = ? AND is_deleted = 0
      LIMIT 1
    `,
            [categoryId],
        );
        const category = rows[0];

        if (!category || (category.user_id && category.user_id !== userId)) {
            return fail(res, MESSAGE_CODES.CATEGORY_NOT_FOUND);
        }

        const updateFields = [];
        const updateValues = [];

        if (name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (parent_id !== undefined) {
            updateFields.push('parent_id = ?');
            updateValues.push(parent_id || null);
        }
        if (icon !== undefined) {
            updateFields.push('icon = ?');
            updateValues.push(icon || null);
        }
        if (color !== undefined) {
            updateFields.push('color = ?');
            updateValues.push(color || null);
        }
        if (sort_order !== undefined) {
            updateFields.push('sort_order = ?');
            updateValues.push(sort_order);
        }
        if (is_system !== undefined) {
            updateFields.push('is_system = ?');
            updateValues.push(is_system);
        }
        if (updateFields.length === 0) {
            return success(res, MESSAGE_CODES.UPDATE_SUCCESS);
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(categoryId);

        await query(
            `
      UPDATE fs_categories
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `,
            updateValues,
        );

        return success(res, MESSAGE_CODES.UPDATE_SUCCESS);
    } catch (err) {
        console.error('PUT /api/categories/:id error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/categories/delete:
 *   delete:
 *     summary: 删除分类（软删除，分类ID通过 body 传入）
 *     tags: [Categories]
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
 *                 description: 分类ID
 *     responses:
 *       200:
 *         description: 删除成功
 *       401:
 *         description: 未认证
 *       404:
 *         description: 分类不存在
 *       500:
 *         description: 服务器内部错误
 */
router.delete('/categories/delete', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.body || {};
        const categoryId = Number(id);

        if (!categoryId) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const rows = await query(
            `
      SELECT id, user_id, is_deleted
      FROM fs_categories
      WHERE id = ? AND is_deleted = 0
      LIMIT 1
    `,
            [categoryId],
        );
        const category = rows[0];

        if (!category || (category.user_id && category.user_id !== userId)) {
            return fail(res, MESSAGE_CODES.CATEGORY_NOT_FOUND);
        }

        await query(
            `
      UPDATE fs_categories
      SET is_deleted = 1, updated_at = NOW()
      WHERE id = ?
    `,
            [categoryId],
        );

        return success(res, MESSAGE_CODES.SUCCESS);
    } catch (err) {
        console.error('DELETE /api/categories/:id error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

module.exports = router;



