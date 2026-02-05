const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/auth');
const { query } = require('../config/database');
const { success, fail, httpError, MESSAGE_CODES } = require('../utils/response');

/**
 * 将 ISO 8601 格式的时间字符串转换为 MySQL DATETIME 格式
 * @param {string} isoString - ISO 8601 格式的时间字符串，如 "2026-02-04T13:47:19.029Z"
 * @returns {string} MySQL DATETIME 格式，如 "2026-02-04 13:47:19"
 */
function formatDateTimeForMySQL(isoString) {
    if (!isoString) {
        return null;
    }
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) {
            throw new Error('Invalid date string');
        }
        // 格式化为 MySQL DATETIME 格式：YYYY-MM-DD HH:MM:SS
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch (err) {
        console.error('formatDateTimeForMySQL error:', err);
        throw new Error('Invalid date format');
    }
}

// 所有记账记录接口均需要登录
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Records
 *   description: 记账记录相关接口
 */

/**
 * @swagger
 * /api/records:
 *   post:
 *     summary: 创建记账记录
 *     tags: [Records]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type_id
 *               - amount
 *               - category_id
 *               - occurred_at
 *             properties:
 *               type_id:
 *                 type: integer
 *                 description: 记账类型ID，关联 fs_record_types.id
 *               amount:
 *                 type: number
 *                 format: double
 *                 description: 金额（单位：元，CNY）
 *               category_id:
 *                 type: integer
 *                 description: 分类ID，关联 fs_categories.id
 *               occurred_at:
 *                 type: string
 *                 format: date-time
 *                 description: 发生时间（UTC ISO 字符串，前端默认东8区换算）
 *               remark:
 *                 type: string
 *                 description: 备注（可选）
 *               tag_ids:
 *                 type: array
 *                 description: 标签ID数组（可选）
 *                 items:
 *                   type: integer
 *           example:
 *             type_id: 1
 *             amount: 88.8
 *             category_id: 10
 *             occurred_at: "2025-01-01T04:30:00Z"
 *             remark: "午饭"
 *             tag_ids: [1, 2]
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
router.post('/records', async (req, res) => {
    try {
        const userId = req.user.id;
        const { type_id, amount, category_id, occurred_at, remark, tag_ids = [] } = req.body || {};

        if (!type_id || !amount || !category_id || !occurred_at) {
            return fail(res, MESSAGE_CODES.RECORD_REQUIRED_FIELDS);
        }

        if (Number(amount) <= 0) {
            return fail(res, MESSAGE_CODES.RECORD_AMOUNT_INVALID);
        }

        // 转换时间格式为 MySQL DATETIME 格式
        let mysqlDateTime;
        try {
            mysqlDateTime = formatDateTimeForMySQL(occurred_at);
            if (!mysqlDateTime) {
                return fail(res, MESSAGE_CODES.INVALID_PARAMS, null, '发生时间格式不正确');
            }
        } catch (err) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS, null, '发生时间格式不正确');
        }

        const conn = await query.getConnection ? await query.getConnection() : null;
        const exec = async (sql, params) => {
            if (conn) {
                // conn.query() 返回 [rows, fields]
                const [rows] = await conn.query(sql, params);
                return rows;
            }
            // query() 已经返回 results（不是数组）
            return await query(sql, params);
        };

        // 用于获取 INSERT 操作的 insertId
        const execInsert = async (sql, params) => {
            if (conn) {
                // conn.query() 返回 [result, fields]，result 包含 insertId
                const [result] = await conn.query(sql, params);
                return result;
            }
            // query() 返回 result，包含 insertId
            return await query(sql, params);
        };

        if (conn) {
            await conn.beginTransaction();
        }

        try {
            // 插入记录
            const result = await execInsert(
                `
        INSERT INTO fs_records (user_id, type_id, category_id, amount, occurred_at, remark)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
                [userId, type_id, category_id, amount, mysqlDateTime, remark || null],
            );
            const recordId = result.insertId;

            // 标签关联
            const normalizedTagIds = Array.isArray(tag_ids) ? tag_ids : [];
            if (normalizedTagIds.length > 0) {
                // 批量插入标签：构建 (?, ?), (?, ?) 格式
                const placeholders = normalizedTagIds.map(() => '(?, ?)').join(', ');
                const tagParams = normalizedTagIds.flatMap((tagId) => [recordId, tagId]);
                await exec(
                    `
            INSERT INTO fs_record_tags (record_id, tag_id)
            VALUES ${placeholders}
          `,
                    tagParams,
                );
            }

            // 写历史（CREATE）
            const snapshotAfter = {
                user_id: userId,
                type_id,
                category_id,
                amount,
                occurred_at,
                remark: remark || null,
                tag_ids: normalizedTagIds,
            };
            await exec(
                `
        INSERT INTO fs_record_history (record_id, user_id, operation, snapshot_before, snapshot_after)
        VALUES (?, ?, 'CREATE', NULL, ?)
      `,
                [recordId, userId, JSON.stringify(snapshotAfter)],
            );

            if (conn) {
                await conn.commit();
            }

            return success(res, MESSAGE_CODES.SUCCESS, { id: recordId });
        } catch (err) {
            if (conn) {
                await conn.rollback();
            }
            console.error('POST /api/records error:', err);
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
        } finally {
            if (conn) {
                conn.release();
            }
        }
    } catch (err) {
        console.error('POST /api/records outer error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/records/update:
 *   put:
 *     summary: 修改记账记录（通过 body 传入记录ID和要修改的字段，避免在URL中暴露ID）
 *     tags: [Records]
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
 *                 description: 记录ID（为避免在URL中暴露，放在 body 中）
 *               type_id:
 *                 type: integer
 *               amount:
 *                 type: number
 *                 format: double
 *               category_id:
 *                 type: integer
 *               occurred_at:
 *                 type: string
 *                 format: date-time
 *               remark:
 *                 type: string
 *               tag_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: 修改成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       404:
 *         description: 记录不存在
 *       500:
 *         description: 服务器内部错误
 */
router.put('/records/update', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, type_id, amount, category_id, occurred_at, remark, tag_ids } = req.body || {};

        const recordId = Number(id);
        if (!recordId) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const conn = await query.getConnection ? await query.getConnection() : null;
        const exec = async (sql, params) => {
            if (conn) {
                // conn.query() 返回 [rows, fields]
                const [rows] = await conn.query(sql, params);
                return rows;
            }
            // query() 已经返回 results（不是数组）
            return await query(sql, params);
        };

        if (conn) {
            await conn.beginTransaction();
        }

        try {
            // 查询旧记录
            const rows = await exec(
                `
        SELECT id, user_id, type_id, category_id, amount, occurred_at, remark, is_deleted
        FROM fs_records
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
                [recordId, userId],
            );
            const oldRecord = rows && rows[0];

            if (!oldRecord || oldRecord.is_deleted) {
                if (conn) {
                    await conn.rollback();
                    conn.release();
                }
                return fail(res, MESSAGE_CODES.RECORD_NOT_FOUND);
            }

            // 查询旧标签
            const tagRows = await exec(
                `
        SELECT tag_id
        FROM fs_record_tags
        WHERE record_id = ?
      `,
                [recordId],
            );
            const oldTagIds = (tagRows || []).map((r) => r.tag_id);

            const snapshotBefore = {
                user_id: oldRecord.user_id,
                type_id: oldRecord.type_id,
                category_id: oldRecord.category_id,
                amount: oldRecord.amount,
                occurred_at: oldRecord.occurred_at,
                remark: oldRecord.remark,
                tag_ids: oldTagIds,
            };

            const updateFields = [];
            const updateValues = [];

            if (type_id !== undefined) {
                updateFields.push('type_id = ?');
                updateValues.push(type_id);
            }
            if (amount !== undefined) {
                if (Number(amount) <= 0) {
                    return fail(res, MESSAGE_CODES.RECORD_AMOUNT_INVALID);
                }
                updateFields.push('amount = ?');
                updateValues.push(amount);
            }
            if (category_id !== undefined) {
                updateFields.push('category_id = ?');
                updateValues.push(category_id);
            }
            if (occurred_at !== undefined) {
                // 转换时间格式为 MySQL DATETIME 格式
                let mysqlDateTime;
                try {
                    mysqlDateTime = formatDateTimeForMySQL(occurred_at);
                    if (!mysqlDateTime) {
                        if (conn) {
                            await conn.rollback();
                            conn.release();
                        }
                        return fail(res, MESSAGE_CODES.INVALID_PARAMS, null, '发生时间格式不正确');
                    }
                } catch (err) {
                    if (conn) {
                        await conn.rollback();
                        conn.release();
                    }
                    return fail(res, MESSAGE_CODES.INVALID_PARAMS, null, '发生时间格式不正确');
                }
                updateFields.push('occurred_at = ?');
                updateValues.push(mysqlDateTime);
            }
            if (remark !== undefined) {
                updateFields.push('remark = ?');
                updateValues.push(remark || null);
            }

            if (updateFields.length > 0) {
                updateFields.push('updated_at = NOW()');
                updateValues.push(recordId, userId);

                await exec(
                    `
          UPDATE fs_records
          SET ${updateFields.join(', ')}
          WHERE id = ? AND user_id = ?
        `,
                    updateValues,
                );
            }

            // 更新标签
            let newTagIds = oldTagIds;
            if (Array.isArray(tag_ids)) {
                newTagIds = tag_ids;
                await exec(
                    `
          DELETE FROM fs_record_tags
          WHERE record_id = ?
        `,
                    [recordId],
                );
                if (newTagIds.length > 0) {
                    // 批量插入标签：构建 (?, ?), (?, ?) 格式
                    const placeholders = newTagIds.map(() => '(?, ?)').join(', ');
                    const tagParams = newTagIds.flatMap((tagId) => [recordId, tagId]);
                    await exec(
                        `
            INSERT INTO fs_record_tags (record_id, tag_id)
            VALUES ${placeholders}
          `,
                        tagParams,
                    );
                }
            }

            const snapshotAfter = {
                user_id: userId,
                type_id: type_id !== undefined ? type_id : oldRecord.type_id,
                category_id: category_id !== undefined ? category_id : oldRecord.category_id,
                amount: amount !== undefined ? amount : oldRecord.amount,
                occurred_at: occurred_at !== undefined ? occurred_at : oldRecord.occurred_at,
                remark: remark !== undefined ? remark || null : oldRecord.remark,
                tag_ids: newTagIds,
            };

            await exec(
                `
        INSERT INTO fs_record_history (record_id, user_id, operation, snapshot_before, snapshot_after)
        VALUES (?, ?, 'UPDATE', ?, ?)
      `,
                [recordId, userId, JSON.stringify(snapshotBefore), JSON.stringify(snapshotAfter)],
            );

            if (conn) {
                await conn.commit();
                conn.release();
            }

            return success(res, MESSAGE_CODES.UPDATE_SUCCESS);
        } catch (err) {
            if (conn) {
                await conn.rollback();
                conn.release();
            }
            console.error('PUT /api/records/:id error:', err);
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
        }
    } catch (err) {
        console.error('PUT /api/records/:id outer error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/records/delete:
 *   delete:
 *     summary: 删除记账记录（软删除，ID 通过 body 传入以避免在URL中暴露）
 *     tags: [Records]
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
 *                 description: 要删除的记录ID
 *     responses:
 *       200:
 *         description: 删除成功
 *       401:
 *         description: 未认证
 *       404:
 *         description: 记录不存在
 *       500:
 *         description: 服务器内部错误
 */
router.delete('/records/delete', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.body || {};
        const recordId = Number(id);

        if (!recordId) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const conn = await query.getConnection ? await query.getConnection() : null;
        const exec = async (sql, params) => {
            if (conn) {
                // conn.query() 返回 [rows, fields]
                const [rows] = await conn.query(sql, params);
                return rows;
            }
            // query() 已经返回 results（不是数组）
            return await query(sql, params);
        };

        if (conn) {
            await conn.beginTransaction();
        }

        try {
            // 查询旧记录
            const rows = await exec(
                `
        SELECT id, user_id, type_id, category_id, amount, occurred_at, remark, is_deleted
        FROM fs_records
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
                [recordId, userId],
            );
            const oldRecord = rows && rows[0];

            if (!oldRecord || oldRecord.is_deleted) {
                if (conn) {
                    await conn.rollback();
                    conn.release();
                }
                return fail(res, MESSAGE_CODES.RECORD_NOT_FOUND);
            }

            const tagRows = await exec(
                `
        SELECT tag_id
        FROM fs_record_tags
        WHERE record_id = ?
      `,
                [recordId],
            );
            const oldTagIds = (tagRows || []).map((r) => r.tag_id);

            const snapshotBefore = {
                user_id: oldRecord.user_id,
                type_id: oldRecord.type_id,
                category_id: oldRecord.category_id,
                amount: oldRecord.amount,
                occurred_at: oldRecord.occurred_at,
                remark: oldRecord.remark,
                tag_ids: oldTagIds,
            };

            await exec(
                `
        UPDATE fs_records
        SET is_deleted = 1, updated_at = NOW()
        WHERE id = ? AND user_id = ?
      `,
                [recordId, userId],
            );

            await exec(
                `
        INSERT INTO fs_record_history (record_id, user_id, operation, snapshot_before, snapshot_after)
        VALUES (?, ?, 'DELETE', ?, NULL)
      `,
                [recordId, userId, JSON.stringify(snapshotBefore)],
            );

            if (conn) {
                await conn.commit();
                conn.release();
            }

            return success(res, MESSAGE_CODES.SUCCESS);
        } catch (err) {
            if (conn) {
                await conn.rollback();
                conn.release();
            }
            console.error('DELETE /api/records/:id error:', err);
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
        }
    } catch (err) {
        console.error('DELETE /api/records/:id outer error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/records/detail:
 *   post:
 *     summary: 获取单条记账记录详情（通过 body 传入记录ID，避免在URL中暴露）
 *     tags: [Records]
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
 *                 description: 记录ID
 *     responses:
 *       200:
 *         description: 获取成功
 *       401:
 *         description: 未认证
 *       404:
 *         description: 记录不存在
 *       500:
 *         description: 服务器内部错误
 */
router.post('/records/detail', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.body || {};
        const recordId = Number(id);

        if (!recordId) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const rows = await query(
            `
      SELECT
        r.id,
        r.user_id,
        r.type_id,
        t.name AS type_name,
        r.category_id,
        c.name AS category_name,
        r.amount,
        r.occurred_at,
        r.remark
      FROM fs_records r
      LEFT JOIN fs_record_types t ON r.type_id = t.id
      LEFT JOIN fs_categories c ON r.category_id = c.id
      WHERE r.id = ? AND r.user_id = ? AND r.is_deleted = 0
      LIMIT 1
    `,
            [recordId, userId],
        );

        const record = rows[0];

        if (!record) {
            return fail(res, MESSAGE_CODES.RECORD_NOT_FOUND);
        }

        const tagRows = await query(
            `
      SELECT rt.tag_id AS id, tg.name
      FROM fs_record_tags rt
      JOIN fs_tags tg ON rt.tag_id = tg.id
      WHERE rt.record_id = ? AND tg.is_deleted = 0
    `,
            [recordId],
        );

        const data = {
            id: record.id,
            type_id: record.type_id,
            type_name: record.type_name,
            amount: record.amount,
            category: {
                id: record.category_id,
                name: record.category_name,
            },
            occurred_at: record.occurred_at,
            remark: record.remark,
            tags: tagRows || [],
        };

        return success(res, MESSAGE_CODES.GET_SUCCESS, { record: data });
    } catch (err) {
        console.error('GET /api/records/:id error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/records/list:
 *   post:
 *     summary: 分页查询记账记录列表（通过 body 传参，避免在URL中暴露筛选条件）
 *     description: |
 *       分页查询当前用户的记账记录，支持多条件筛选。
 *       所有参数均为可选，但建议至少传入分页参数。
 *       响应统一为 { code, message, data }，其中 data 包含 list、pagination、summary。
 *     tags: [Records]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               page:
 *                 type: integer
 *                 description: 页码（可选，默认1，最小值1）
 *                 example: 1
 *               page_size:
 *                 type: integer
 *                 description: 每页数量（可选，默认20，范围1-100）
 *                 example: 20
 *               start_date:
 *                 type: string
 *                 format: date
 *                 description: 起始日期（可选，东8区，YYYY-MM-DD格式）
 *                 example: "2025-01-01"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 description: 结束日期（可选，东8区，YYYY-MM-DD格式）
 *                 example: "2025-01-31"
 *               type_id:
 *                 type: integer
 *                 description: 记账类型ID（可选，筛选特定类型）
 *                 example: 1
 *               category_id:
 *                 type: integer
 *                 description: 分类ID（可选，筛选特定分类）
 *                 example: 10
 *               tag_id:
 *                 type: integer
 *                 description: 标签ID（可选，筛选包含特定标签的记录）
 *                 example: 2
 *               min_amount:
 *                 type: number
 *                 format: double
 *                 description: 最小金额（可选，筛选金额大于等于此值的记录）
 *                 example: 10.0
 *               max_amount:
 *                 type: number
 *                 format: double
 *                 description: 最大金额（可选，筛选金额小于等于此值的记录）
 *                 example: 1000.0
 *               keyword:
 *                 type: string
 *                 description: 备注关键字（可选，模糊匹配备注字段）
 *                 example: "午饭"
 *               order_by:
 *                 type: string
 *                 enum: [occurred_at, amount, created_at]
 *                 description: 排序字段（可选，默认 occurred_at）
 *                 example: "occurred_at"
 *               order:
 *                 type: string
 *                 enum: [asc, desc]
 *                 description: 排序方向（可选，默认 desc）
 *                 example: "desc"
 *           example:
 *             page: 1
 *             page_size: 20
 *             start_date: "2025-01-01"
 *             end_date: "2025-01-31"
 *             type_id: 1
 *             order_by: "occurred_at"
 *             order: "desc"
 *     responses:
 *       200:
 *         description: 获取成功
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
 *                   example: "获取成功"
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           type_id:
 *                             type: integer
 *                           type_name:
 *                             type: string
 *                           category_id:
 *                             type: integer
 *                           category_name:
 *                             type: string
 *                           amount:
 *                             type: number
 *                           occurred_at:
 *                             type: string
 *                           remark:
 *                             type: string
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         page_size:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total_amount:
 *                           type: number
 *       401:
 *         description: 未认证
 *       500:
 *         description: 服务器内部错误
 */
router.post('/records/list', async (req, res) => {
    try {
        const userId = req.user.id;

        // 验证 userId 是否有效
        if (!userId) {
            console.error('❌ userId 无效:', userId);
            return httpError(res, 401, MESSAGE_CODES.UNAUTHORIZED, null, '用户ID无效');
        }

        const {
            page = 1,
            page_size = 20,
            start_date,
            end_date,
            type_id,
            category_id,
            tag_id,
            min_amount,
            max_amount,
            keyword,
            order_by,
            order,
        } = req.body || {};

        let pageNum = Number(page) || 1;
        let pageSizeNum = Number(page_size) || 20;

        // 验证并规范化分页参数
        if (isNaN(pageNum) || pageNum < 1) {
            pageNum = 1;
        }
        pageNum = Math.max(pageNum, 1);

        if (isNaN(pageSizeNum) || pageSizeNum < 1) {
            pageSizeNum = 20;
        }
        pageSizeNum = Math.min(Math.max(pageSizeNum, 1), 100);

        // 确保 userId 是数字类型（MySQL 的 INT 列需要数字类型）
        const userIdNum = Number(userId);
        if (isNaN(userIdNum)) {
            console.error('❌ userId 无法转换为数字:', userId);
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR, null, '用户ID格式错误');
        }

        // 计算 offset 并确保是有效数字
        const offset = (pageNum - 1) * pageSizeNum;
        if (isNaN(offset) || offset < 0) {
            console.error('❌ offset 计算错误:', { pageNum, pageSizeNum, offset });
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR, null, '分页参数错误');
        }

        const whereClauses = ['r.user_id = ?', 'r.is_deleted = 0'];
        const params = [userIdNum];

        if (type_id) {
            whereClauses.push('r.type_id = ?');
            params.push(Number(type_id));
        }
        if (category_id) {
            whereClauses.push('r.category_id = ?');
            params.push(Number(category_id));
        }
        if (min_amount) {
            whereClauses.push('r.amount >= ?');
            params.push(Number(min_amount));
        }
        if (max_amount) {
            whereClauses.push('r.amount <= ?');
            params.push(Number(max_amount));
        }
        if (keyword) {
            whereClauses.push('r.remark LIKE ?');
            params.push(`%${keyword}%`);
        }

        // 时间范围（这里先简单按 UTC 日期字符串拼接，实际可在SQL中做时区转换）
        if (start_date) {
            whereClauses.push('DATE(r.occurred_at) >= ?');
            params.push(start_date);
        }
        if (end_date) {
            whereClauses.push('DATE(r.occurred_at) <= ?');
            params.push(end_date);
        }

        const baseWhere = whereClauses.join(' AND ');
        const finalOrderBy = ['occurred_at', 'amount', 'created_at'].includes(order_by)
            ? order_by
            : 'occurred_at';
        const finalOrder = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        // 总数
        let totalSql;
        let totalParams;
        if (tag_id) {
            // 有 tag_id 时，需要额外的 tag_id 参数
            totalSql = `
        SELECT COUNT(DISTINCT r.id) AS total
        FROM fs_records r
        JOIN fs_record_tags rt ON r.id = rt.record_id
        WHERE ${baseWhere} AND rt.tag_id = ?
      `;
            totalParams = [...params, Number(tag_id)];
        } else {
            totalSql = `
        SELECT COUNT(*) AS total
        FROM fs_records r
        WHERE ${baseWhere}
      `;
            totalParams = params;
        }

        const totalRows = await query(totalSql, totalParams);
        const total = (totalRows[0] && totalRows[0].total) || 0;

        // 列表
        let listSql;
        let listParams;

        if (tag_id) {
            // 有 tag_id 时，需要额外的 tag_id 参数
            const tagIdNum = Number(tag_id);
            if (isNaN(tagIdNum)) {
                console.error('❌ tag_id 无法转换为数字:', tag_id);
                return httpError(res, 400, MESSAGE_CODES.INVALID_PARAMS, null, '标签ID格式错误');
            }

            // 注意：LIMIT 不使用占位符，因为 MySQL prepared statement 对 LIMIT 占位符支持有问题
            // offset 和 pageSizeNum 已经过严格验证，直接拼接是安全的
            listSql = `
        SELECT
          r.id,
          r.type_id,
          t.name AS type_name,
          r.category_id,
          c.name AS category_name,
          r.amount,
          r.occurred_at,
          r.remark
        FROM fs_records r
        JOIN fs_record_tags rt ON r.id = rt.record_id
        LEFT JOIN fs_record_types t ON r.type_id = t.id
        LEFT JOIN fs_categories c ON r.category_id = c.id
        WHERE ${baseWhere} AND rt.tag_id = ?
        GROUP BY r.id
        ORDER BY r.\`${finalOrderBy}\` ${finalOrder}
        LIMIT ${offset}, ${pageSizeNum}
      `;
            listParams = [...params, tagIdNum];
        } else {
            // 注意：LIMIT 不使用占位符，因为 MySQL prepared statement 对 LIMIT 占位符支持有问题
            // offset 和 pageSizeNum 已经过严格验证，直接拼接是安全的
            listSql = `
        SELECT
          r.id,
          r.type_id,
          t.name AS type_name,
          r.category_id,
          c.name AS category_name,
          r.amount,
          r.occurred_at,
          r.remark
        FROM fs_records r
        LEFT JOIN fs_record_types t ON r.type_id = t.id
        LEFT JOIN fs_categories c ON r.category_id = c.id
        WHERE ${baseWhere}
        ORDER BY r.\`${finalOrderBy}\` ${finalOrder}
        LIMIT ${offset}, ${pageSizeNum}
      `;
            listParams = params;
        }

        // 调试：打印 SQL 和参数（开发环境可启用）
        // const placeholderCount = (listSql.match(/\?/g) || []).length;
        // if (listParams.length !== placeholderCount) {
        //     console.error('SQL参数数量不匹配！');
        //     console.error('SQL:', listSql);
        //     console.error('参数数量:', listParams.length);
        //     console.error('占位符数量:', placeholderCount);
        //     console.error('参数:', listParams);
        //     return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR, null, 'SQL参数数量不匹配');
        // }

        // 调试：检查参数值是否有效
        // console.log('=== 调试信息 ===');
        // console.log('userIdNum:', userIdNum, 'type:', typeof userIdNum);
        // console.log('pageNum:', pageNum, 'type:', typeof pageNum);
        // console.log('pageSizeNum:', pageSizeNum, 'type:', typeof pageSizeNum);
        // console.log('offset:', offset, 'type:', typeof offset);
        // console.log('tag_id:', tag_id, 'type:', typeof tag_id);
        // console.log('baseWhere:', baseWhere);
        // console.log('params:', params);
        // console.log('listParams:', listParams);
        // console.log('listParams详细:', listParams.map((p, i) => `[${i}]: ${p} (${typeof p})`));
        // console.log('listSql预览:', listSql);

        // 检查是否有无效参数
        const hasInvalidParam = listParams.some(p => p === undefined || p === null || (typeof p === 'number' && isNaN(p)));
        if (hasInvalidParam) {
            console.error('❌ 发现无效参数！');
            listParams.forEach((p, i) => {
                if (p === undefined || p === null || (typeof p === 'number' && isNaN(p))) {
                    console.error(`  参数[${i}] 无效: ${p} (${typeof p})`);
                }
            });
            return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR, null, '数据库参数包含无效值');
        }

        const rows = await query(listSql, listParams);

        const list = rows.map((r) => ({
            id: r.id,
            type_id: r.type_id,
            type_name: r.type_name,
            category_id: r.category_id,
            category_name: r.category_name,
            amount: r.amount,
            occurred_at: r.occurred_at,
            remark: r.remark,
        }));

        // 汇总（总金额）
        let sumSql;
        let sumParams;
        if (tag_id) {
            // 有 tag_id 时，需要额外的 tag_id 参数
            sumSql = `
        SELECT SUM(r.amount) AS total_amount
        FROM fs_records r
        JOIN fs_record_tags rt ON r.id = rt.record_id
        WHERE ${baseWhere} AND rt.tag_id = ?
      `;
            sumParams = [...params, Number(tag_id)];
        } else {
            sumSql = `
        SELECT SUM(r.amount) AS total_amount
        FROM fs_records r
        WHERE ${baseWhere}
      `;
            sumParams = params;
        }

        const sumRows = await query(sumSql, sumParams);
        const totalAmount = (sumRows[0] && sumRows[0].total_amount) || 0;

        return success(res, MESSAGE_CODES.GET_SUCCESS, {
            list,
            pagination: {
                page: pageNum,
                page_size: pageSizeNum,
                total,
            },
            summary: {
                total_amount: totalAmount,
            },
        });
    } catch (err) {
        console.error('POST /api/records/list error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/records/summary:
 *   get:
 *     summary: 记账金额按日期聚合统计
 *     description: |
 *       按天或按月统计指定时间范围内的记账总金额。
 *       响应统一为 { code, message, data }，其中 data.items 为聚合结果数组。
 *     tags: [Records]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: 起始日期（YYYY-MM-DD，按东8区理解）
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期（YYYY-MM-DD，按东8区理解）
 *       - in: query
 *         name: group_by
 *         schema:
 *           type: string
 *           enum: [day, month]
 *         description: 聚合粒度，day（默认）或 month
 *       - in: query
 *         name: type_id
 *         schema:
 *           type: integer
 *         description: 记账类型ID（可选，用于只看某一类，如仅支出）
 *     responses:
 *       200:
 *         description: 获取成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       500:
 *         description: 服务器内部错误
 */
router.get('/records/summary', async (req, res) => {
    try {
        const userId = req.user.id;
        const { start_date, end_date, group_by = 'day', type_id } = req.query || {};

        if (!start_date || !end_date) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const groupBy = group_by === 'month' ? 'month' : 'day';

        const whereClauses = ['user_id = ?', 'is_deleted = 0'];
        const params = [userId];

        whereClauses.push('DATE(occurred_at) >= ?');
        params.push(start_date);
        whereClauses.push('DATE(occurred_at) <= ?');
        params.push(end_date);

        if (type_id) {
            whereClauses.push('type_id = ?');
            params.push(Number(type_id));
        }

        const groupExpr =
            groupBy === 'month'
                ? "DATE_FORMAT(occurred_at, '%Y-%m-01')"
                : 'DATE(occurred_at)';

        const sql = `
      SELECT
        ${groupExpr} AS stat_date,
        SUM(amount) AS total_amount
      FROM fs_records
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY stat_date
      ORDER BY stat_date ASC
    `;

        const rows = await query(sql, params);

        const items = rows.map((r) => ({
            date: r.stat_date,
            total_amount: r.total_amount || 0,
        }));

        return success(res, MESSAGE_CODES.GET_SUCCESS, { items });
    } catch (err) {
        console.error('GET /api/records/summary error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

/**
 * @swagger
 * /api/records/summary-by-category:
 *   get:
 *     summary: 按分类聚合统计记账金额
 *     description: |
 *       在指定时间范围内，按分类统计总金额及占比。
 *       响应统一为 { code, message, data }，其中 data.items 为聚合结果数组。
 *     tags: [Records]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: 起始日期（YYYY-MM-DD，按东8区理解）
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期（YYYY-MM-DD，按东8区理解）
 *       - in: query
 *         name: type_id
 *         schema:
 *           type: integer
 *         description: 记账类型ID（可选）
 *     responses:
 *       200:
 *         description: 获取成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未认证
 *       500:
 *         description: 服务器内部错误
 */
router.get('/records/summary-by-category', async (req, res) => {
    try {
        const userId = req.user.id;
        const { start_date, end_date, type_id } = req.query || {};

        if (!start_date || !end_date) {
            return fail(res, MESSAGE_CODES.INVALID_PARAMS);
        }

        const whereClauses = ['r.user_id = ?', 'r.is_deleted = 0'];
        const params = [userId];

        whereClauses.push('DATE(r.occurred_at) >= ?');
        params.push(start_date);
        whereClauses.push('DATE(r.occurred_at) <= ?');
        params.push(end_date);

        if (type_id) {
            whereClauses.push('r.type_id = ?');
            params.push(Number(type_id));
        }

        const baseWhere = whereClauses.join(' AND ');

        // 总金额
        const totalSql = `
      SELECT SUM(r.amount) AS total_amount
      FROM fs_records r
      WHERE ${baseWhere}
    `;
        const totalRows = await query(totalSql, params);
        const totalAmount = (totalRows[0] && totalRows[0].total_amount) || 0;

        const sql = `
      SELECT
        r.category_id,
        c.name AS category_name,
        SUM(r.amount) AS total_amount
      FROM fs_records r
      LEFT JOIN fs_categories c ON r.category_id = c.id
      WHERE ${baseWhere}
      GROUP BY r.category_id, c.name
      ORDER BY total_amount DESC
    `;

        const rows = await query(sql, params);

        const items = rows.map((r) => {
            const amt = r.total_amount || 0;
            return {
                category_id: r.category_id,
                category_name: r.category_name,
                total_amount: amt,
                percent: totalAmount > 0 ? amt / totalAmount : 0,
            };
        });

        return success(res, MESSAGE_CODES.GET_SUCCESS, { items, total_amount: totalAmount });
    } catch (err) {
        console.error('GET /api/records/summary-by-category error:', err);
        return httpError(res, 500, MESSAGE_CODES.INTERNAL_SERVER_ERROR);
    }
});

module.exports = router;



