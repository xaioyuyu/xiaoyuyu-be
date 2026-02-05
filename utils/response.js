/**
 * 统一响应工具
 * 业务成功：HTTP 200, code=0
 * 业务失败：HTTP 200, code=-1
 * HTTP错误：使用对应的HTTP状态码（如401未认证、404未找到、500服务器错误等）
 */

// 消息编码映射表
const MESSAGE_CODES = {
    // 成功消息
    SUCCESS: 'SUCCESS',
    REGISTER_SUCCESS: 'REGISTER_SUCCESS',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGOUT_SUCCESS: 'LOGOUT_SUCCESS',
    UPDATE_SUCCESS: 'UPDATE_SUCCESS',
    GET_SUCCESS: 'GET_SUCCESS',

    // 业务失败消息
    USERNAME_OR_EMAIL_REQUIRED: 'USERNAME_OR_EMAIL_REQUIRED',
    PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
    USERNAME_OR_PASSWORD_ERROR: 'USERNAME_OR_PASSWORD_ERROR',
    USERNAME_EXISTS: 'USERNAME_EXISTS',
    EMAIL_EXISTS: 'EMAIL_EXISTS',
    USERNAME_OR_EMAIL_EXISTS: 'USERNAME_OR_EMAIL_EXISTS',
    ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    INVALID_EMAIL_FORMAT: 'INVALID_EMAIL_FORMAT',
    INVALID_USERNAME_FORMAT: 'INVALID_USERNAME_FORMAT',
    USERNAME_LENGTH_INVALID: 'USERNAME_LENGTH_INVALID',
    NO_FIELDS_TO_UPDATE: 'NO_FIELDS_TO_UPDATE',
    USER_NOT_FOUND: 'USER_NOT_FOUND',

    // HTTP错误消息（真正的HTTP层面错误）
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',

    // 记账记录相关
    RECORD_REQUIRED_FIELDS: 'RECORD_REQUIRED_FIELDS',
    RECORD_AMOUNT_INVALID: 'RECORD_AMOUNT_INVALID',
    RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',

    // 分类相关
    CATEGORY_REQUIRED_FIELDS: 'CATEGORY_REQUIRED_FIELDS',
    CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',

    // 标签相关
    TAG_REQUIRED_FIELDS: 'TAG_REQUIRED_FIELDS',
    TAG_NOT_FOUND: 'TAG_NOT_FOUND',

    // 记录类型相关
    RECORD_TYPE_REQUIRED_FIELDS: 'RECORD_TYPE_REQUIRED_FIELDS',
    RECORD_TYPE_NOT_FOUND: 'RECORD_TYPE_NOT_FOUND',
    RECORD_TYPE_CODE_EXISTS: 'RECORD_TYPE_CODE_EXISTS',

    // 通用
    INVALID_PARAMS: 'INVALID_PARAMS',
};

// 消息编码到中文的映射
const MESSAGE_MAP = {
    [MESSAGE_CODES.SUCCESS]: '操作成功',
    [MESSAGE_CODES.REGISTER_SUCCESS]: '注册成功',
    [MESSAGE_CODES.LOGIN_SUCCESS]: '登录成功',
    [MESSAGE_CODES.LOGOUT_SUCCESS]: '登出成功',
    [MESSAGE_CODES.UPDATE_SUCCESS]: '修改成功',
    [MESSAGE_CODES.GET_SUCCESS]: '获取成功',

    [MESSAGE_CODES.USERNAME_OR_EMAIL_REQUIRED]: '用户名、邮箱和密码不能为空',
    [MESSAGE_CODES.PASSWORD_REQUIRED]: '用户名和密码不能为空',
    [MESSAGE_CODES.USERNAME_OR_PASSWORD_ERROR]: '用户名或密码错误',
    [MESSAGE_CODES.USERNAME_EXISTS]: '用户名已被占用',
    [MESSAGE_CODES.EMAIL_EXISTS]: '邮箱已被占用',
    [MESSAGE_CODES.USERNAME_OR_EMAIL_EXISTS]: '用户名或邮箱已存在',
    [MESSAGE_CODES.ACCOUNT_DISABLED]: '账号已被禁用，请联系管理员',
    [MESSAGE_CODES.ACCOUNT_LOCKED]: '账号已被锁定，请稍后重试或联系管理员',
    [MESSAGE_CODES.INVALID_EMAIL_FORMAT]: '邮箱格式不正确',
    [MESSAGE_CODES.INVALID_USERNAME_FORMAT]: '用户名只能包含字母、数字和下划线',
    [MESSAGE_CODES.USERNAME_LENGTH_INVALID]: '用户名长度必须在3-50个字符之间',
    [MESSAGE_CODES.NO_FIELDS_TO_UPDATE]: '请至少提供一个要修改的字段',
    [MESSAGE_CODES.USER_NOT_FOUND]: '用户不存在',

    [MESSAGE_CODES.UNAUTHORIZED]: '未认证，请先登录',
    [MESSAGE_CODES.FORBIDDEN]: '无访问权限',
    [MESSAGE_CODES.NOT_FOUND]: '资源不存在',
    [MESSAGE_CODES.INTERNAL_SERVER_ERROR]: '服务器内部错误',

    // 记账记录相关
    [MESSAGE_CODES.RECORD_REQUIRED_FIELDS]: 'type_id、amount、category_id、occurred_at 不能为空',
    [MESSAGE_CODES.RECORD_AMOUNT_INVALID]: '金额必须大于 0',
    [MESSAGE_CODES.RECORD_NOT_FOUND]: '记账记录不存在',

    // 分类相关
    [MESSAGE_CODES.CATEGORY_REQUIRED_FIELDS]: '分类名称和类型不能为空',
    [MESSAGE_CODES.CATEGORY_NOT_FOUND]: '分类不存在或无权访问',

    // 标签相关
    [MESSAGE_CODES.TAG_REQUIRED_FIELDS]: '标签名称不能为空',
    [MESSAGE_CODES.TAG_NOT_FOUND]: '标签不存在或无权访问',

    // 记录类型相关
    [MESSAGE_CODES.RECORD_TYPE_REQUIRED_FIELDS]: '类型编码和名称不能为空',
    [MESSAGE_CODES.RECORD_TYPE_NOT_FOUND]: '记账类型不存在',
    [MESSAGE_CODES.RECORD_TYPE_CODE_EXISTS]: '类型编码已存在',

    // 通用
    [MESSAGE_CODES.INVALID_PARAMS]: '请求参数不合法',
};

/**
 * 获取消息文本
 * @param {string} code - 消息编码
 * @param {string} customMessage - 自定义消息（可选，如果提供则优先使用）
 * @returns {string} 消息文本
 */
function getMessage(code, customMessage = null) {
    if (customMessage) {
        return customMessage;
    }
    return MESSAGE_MAP[code] || '未知错误';
}

/**
 * 业务成功响应
 * @param {object} res - Express响应对象
 * @param {string} messageCode - 消息编码
 * @param {object} data - 响应数据（可选）
 * @param {string} customMessage - 自定义消息（可选）
 * @returns {object} Express响应
 */
function success(res, messageCode = MESSAGE_CODES.SUCCESS, data = null, customMessage = null) {
    const response = {
        code: 0,
        message: getMessage(messageCode, customMessage),
    };
    if (data !== null) {
        response.data = data;
    }
    return res.status(200).json(response);
}

/**
 * 业务失败响应
 * @param {object} res - Express响应对象
 * @param {string} messageCode - 消息编码
 * @param {object} data - 响应数据（可选）
 * @param {string} customMessage - 自定义消息（可选）
 * @returns {object} Express响应
 */
function fail(res, messageCode, data = null, customMessage = null) {
    const response = {
        code: -1,
        message: getMessage(messageCode, customMessage),
    };
    if (data !== null) {
        response.data = data;
    }
    return res.status(200).json(response);
}

/**
 * HTTP错误响应（真正的HTTP层面错误）
 * @param {object} res - Express响应对象
 * @param {number} httpStatus - HTTP状态码（如401、404、500等）
 * @param {string} messageCode - 消息编码
 * @param {object} data - 响应数据（可选）
 * @param {string} customMessage - 自定义消息（可选）
 * @returns {object} Express响应
 */
function httpError(res, httpStatus, messageCode = MESSAGE_CODES.INTERNAL_SERVER_ERROR, data = null, customMessage = null) {
    const response = {
        code: httpStatus, // HTTP错误时，code使用HTTP状态码
        message: getMessage(messageCode, customMessage),
    };
    if (data !== null) {
        response.data = data;
    }
    return res.status(httpStatus).json(response);
}

module.exports = {
    MESSAGE_CODES,
    success,
    fail,
    httpError,
    getMessage,
};

