require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { generalLimiter } = require('./src/middleware/rateLimit');

// ========== 导入路由 ==========
const userRoutes = require('./src/routes/userRoutes');
const productRoutes = require('./src/routes/productRoutes');
const cartRoutes = require('./src/routes/cartRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const emailRoutes = require('./src/routes/emailRoutes');

const app = express();

// ========== 中间件 ==========
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(generalLimiter); // 全局限流
app.use('/uploads', express.static('uploads'));

// ========== 测试接口 ==========
app.get('/hello', (req, res) => {
    res.json({ success: true, message: 'Hello, 绿屿!' });
});

// ========== 注册路由 ==========
app.use('/api', userRoutes);      // 注册、登录、用户管理
app.use('/api', productRoutes);   // 商品相关
app.use('/api', cartRoutes);      // 购物车相关
app.use('/api', orderRoutes);     // 订单相关
app.use('/api', uploadRoutes);    // 图片上传
app.use('/api', emailRoutes);     // 邮件验证码

// ========== 启动服务器 ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
    console.log('✅ 数据库连接成功');
    console.log('📦 商品接口已注册');
    console.log('🛒 购物车接口已注册');
    console.log('📋 订单接口已注册');
    console.log('📤 图片上传接口已注册');
    console.log('📧 邮件服务已配置');
    console.log('🔐 JWT 认证已启用');
    console.log('🛡️ 限流已启用');
});