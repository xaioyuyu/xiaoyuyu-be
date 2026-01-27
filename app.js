require('dotenv').config();
const express = require('express');
const { testConnection } = require('./config/database');

const app = express();
const port = process.env.PORT || 3030;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 数据库连接测试路由
// app.get('/health', async (req, res) => {
//   const dbStatus = await testConnection();
//   res.json({
//     status: 'ok',
//     database: dbStatus ? 'connected' : 'disconnected',
//     timestamp: new Date().toISOString()
//   });
// });

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// 启动服务器并测试数据库连接
app.listen(port, async () => {
  console.log(`Finsmart API listening on port ${port}`);
  // 启动时测试数据库连接
  await testConnection();
})