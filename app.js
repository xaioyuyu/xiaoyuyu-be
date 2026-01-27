require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { cookieParser } = require('./middlewares/auth');
const { testConnection } = require('./config/database');
const authRoutes = require('./routes/auth');

const app = express();
const port = process.env.PORT || 3030;

// 允许的前端域名（单一域名，可从环境变量中读取）
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000'; // TODO: 请在 .env 中配置正式前端域名

// CORS 配置：单一前端域名 + 携带 Cookie
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true, // 允许携带 Cookie
  }),
);

// 基础中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 数据库连接测试路由（如需要可打开）
// app.get('/health', async (req, res) => {
//   const dbStatus = await testConnection();
//   res.json({
//     status: 'ok',
//     database: dbStatus ? 'connected' : 'disconnected',
//     timestamp: new Date().toISOString()
//   });
// });

// Auth 相关接口
app.use('/api', authRoutes);

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// 启动服务器并测试数据库连接
app.listen(port, async () => {
  console.log(`Finsmart API listening on port ${port}`);
  // 启动时测试数据库连接
  await testConnection();
});
