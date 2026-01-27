const swaggerJSDoc = require('swagger-jsdoc');

// Swagger 基础信息配置
const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Finsmart API',
        version: '1.0.0',
        description: 'Finsmart 后端接口文档（用户认证与权限相关接口）',
    },
    servers: [
        {
            url: process.env.API_BASE_URL || 'http://localhost:3030',
            description: '本地开发环境',
        },
    ],
    components: {
        securitySchemes: {
            // 这里仅描述 Cookie 中的 token，用于文档展示
            cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'access_token',
            },
        },
    },
};

// swagger-jsdoc 配置
const options = {
    swaggerDefinition,
    // 扫描路由文件中的 JSDoc 注释，自动生成文档
    apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;


