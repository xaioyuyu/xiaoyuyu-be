require('dotenv').config();
const mysql = require('mysql2/promise');

// MySQL数据库连接配置
const dbConfig = {
    host: process.env.DB_HOST || 'localhost', // 数据库主机地址，例如：localhost 或 192.168.1.100
    port: process.env.DB_PORT || 3306, // 数据库端口，MySQL默认端口为3306
    user: process.env.DB_USER || 'root', // 数据库用户名
    password: process.env.DB_PASSWORD || '', // 数据库密码
    database: process.env.DB_NAME || 'finsmart', // 数据库名称
    waitForConnections: true, // 是否等待可用连接
    connectionLimit: 10, // 连接池最大连接数
    queueLimit: 0, // 连接队列限制，0表示无限制
    enableKeepAlive: true, // 启用保持连接活跃
    keepAliveInitialDelay: 0, // 保持连接初始延迟（毫秒）
    charset: 'utf8mb4', // 字符集，支持emoji等特殊字符
    timezone: '+08:00' // 时区设置，根据实际情况调整
};

// 创建连接池
const pool = mysql.createPool(dbConfig);

// 测试数据库连接
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL connection successful');
        console.log(`📊 Database: ${dbConfig.database}`);
        console.log(`🌐 Host: ${dbConfig.host}:${dbConfig.port}`);
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ MySQL connection failed:', error.message);
        return false;
    }
}

// 执行查询的辅助函数
async function query(sql, params) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

module.exports = {
    pool,
    testConnection,
    query
};

