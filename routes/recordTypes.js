const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middlewares/auth');
const { query } = require('../config/database');
const { success, fail, httpError, MESSAGE_CODES } = require('../utils/response');

// 记录类型接口需要登录（如果你希望对未登录用户开放，可去掉该中间件）
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: RecordTypes
 *   description: 记账类型字典相关接口
 */

/**
 * @swagger
 * /api/record-types:
 *   get:
 *     summary: 获取记账类型列表
 *     description: |
 *       返回系统中配置的所有记账类型字典，如“支出”、“收入”、“转账”等。
 *       响应统一为 { code, message, data }，其中 data.list 为类型数组。
 *     tags: [RecordTypes]
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
router.get('/record-types', async (req, res) => {
    try {
        const rows = await query(
            `
      SELECT
        id,
        code,
        name,
        description,
        sort_order,
        is_system
      FROM fs_record_types
      WHERE is_deleted = 0
      ORDER BY sort_order ASC, id ASC
    `,
        );

        // 字段结构示例：
        // {
        //   id: 1,
        //   code: 'expense',
        //   name: '支出',
        //   description: '日常支出',
        //   sort_order: 1,
        //   is_system: 1
        // }
        return success(res, MESSAGE_CODES.GET_SUCCESS, { list: rows });
    } catch (err) {
        console.error('GET /api/record-types error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: 后台管理相关接口（仅管理员可访问）
 */

/**
 * @swagger
 * /api/admin/record-types:
 *   post:
 *     summary: 创建系统记账类型（仅管理员）
 *     description: |
 *       创建新的系统记账类型，如"借入"、"借出"等。
 *       响应统一为 { code, message, data }。
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - name
 *             properties:
 *               code:
 *                 type: string
 *                 description: 类型编码（唯一，如 expense/income/transfer）
 *               name:
 *                 type: string
 *                 description: 类型名称（如 支出/收入/转账）
 *               description:
 *                 type: string
 *                 description: 说明（可选）
 *               sort_order:
 *                 type: integer
 *                 description: 排序值（可选，默认0）
 *           example:
 *             code: loan_in
 *             name: 借入
 *             description: 向他人借款
 *             sort_order: 5
 *     responses:
 *       200:
 *         description: 创建成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       403:
 *         description: 无访问权限（非管理员）
 *       409:
 *         description: 类型编码已存在
 *       500:
 *         description: 服务器内部错误
 */
router.post('/admin/record-types', requireRole('admin'), async (req, res) => {
    try {
        const { code, name, description, sort_order } = req.body || {};

        if (!code || !name) {
            return fail(res, MESSAGE_CODES.RECORD_TYPE_REQUIRED_FIELDS);
        }

        // 检查 code 是否已存在
        const existed = await query(
            `
      SELECT id
      FROM fs_record_types
      WHERE code = ? AND is_deleted = 0
      LIMIT 1
    `,
            [code],
        );

        if (existed[0]) {
            return fail(res, MESSAGE_CODES.RECORD_TYPE_CODE_EXISTS);
        }

        const result = await query(
            `
      INSERT INTO fs_record_types
        (code, name, description, sort_order, is_system, is_deleted, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, 1, 0, NOW(), NOW())
    `,
            [code, name, description || null, sort_order || 0],
        );

        return success(res, MESSAGE_CODES.SUCCESS, { id: result.insertId });
    } catch (err) {
        console.error('POST /api/admin/record-types error:', err);
        if (err && err.code === 'ER_DUP_ENTRY') {
            return fail(res, MESSAGE_CODES.RECORD_TYPE_CODE_EXISTS);
        }
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/admin/record-types/update:
 *   put:
 *     summary: 修改系统记账类型（仅管理员）
 *     description: |
 *       修改系统记账类型的名称、描述、排序等信息。
 *       类型编码（code）不允许修改，以确保数据一致性。
 *       响应统一为 { code, message, data }。
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: 类型ID
 *               name:
 *                 type: string
 *                 description: 类型名称（可选）
 *               description:
 *                 type: string
 *                 description: 说明（可选）
 *               sort_order:
 *                 type: integer
 *                 description: 排序值（可选）
 *           example:
 *             id: 1
 *             name: 支出（更新）
 *             description: 日常支出费用
 *             sort_order: 1
 *     responses:
 *       200:
 *         description: 修改成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       403:
 *         description: 无访问权限（非管理员）
 *       404:
 *         description: 类型不存在
 *       500:
 *         description: 服务器内部错误
 */
router.put('/admin/record-types/update', requireRole('admin'), async (req, res) => {
    try {
        const { id, name, description, sort_order } = req.body || {};

        if (!id) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        // 检查类型是否存在
        const rows = await query(
            `
      SELECT id, is_deleted
      FROM fs_record_types
      WHERE id = ?
      LIMIT 1
    `,
            [id],
        );

        if (!rows[0] || rows[0].is_deleted) {
            return fail(res, MESSAGE_CODES.RECORD_TYPE_NOT_FOUND);
        }

        const updateFields = [];
        const updateValues = [];

        if (name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            updateValues.push(description || null);
        }
        if (sort_order !== undefined) {
            updateFields.push('sort_order = ?');
            updateValues.push(sort_order);
        }

        if (updateFields.length === 0) {
            return success(res, MESSAGE_CODES.UPDATE_SUCCESS);
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(id);

        await query(
            `
      UPDATE fs_record_types
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `,
            updateValues,
        );

        return success(res, MESSAGE_CODES.UPDATE_SUCCESS);
    } catch (err) {
        console.error('PUT /api/admin/record-types/update error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/admin/record-types/delete:
 *   delete:
 *     summary: 删除系统记账类型（仅管理员，软删除）
 *     description: |
 *       软删除系统记账类型，已使用的类型仍可正常显示历史数据。
 *       响应统一为 { code, message, data }。
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: 类型ID
 *           example:
 *             id: 1
 *     responses:
 *       200:
 *         description: 删除成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       403:
 *         description: 无访问权限（非管理员）
 *       404:
 *         description: 类型不存在
 *       500:
 *         description: 服务器内部错误
 */
router.delete('/admin/record-types/delete', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.body || {};

        if (!id) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        // 检查类型是否存在
        const rows = await query(
            `
      SELECT id, is_deleted
      FROM fs_record_types
      WHERE id = ?
      LIMIT 1
    `,
            [id],
        );

        if (!rows[0] || rows[0].is_deleted) {
            return fail(res, MESSAGE_CODES.RECORD_TYPE_NOT_FOUND);
        }

        // 软删除
        await query(
            `
      UPDATE fs_record_types
      SET is_deleted = 1, updated_at = NOW()
      WHERE id = ?
    `,
            [id],
        );

        return success(res, MESSAGE_CODES.SUCCESS);
    } catch (err) {
        console.error('DELETE /api/admin/record-types/delete error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

module.exports = router;


