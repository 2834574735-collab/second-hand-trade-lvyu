require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const cors = require('cors');
const db = require('./src/config/db');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ========== 统一响应格式 ==========
function sendSuccess(res, data, message = '操作成功') {
    res.json({ success: true, message, data });
}

function sendError(res, message = '操作失败', status = 400) {
    res.status(status).json({ success: false, message });
}

// ========== JWT 工具函数 ==========
function generateToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            username: user.username,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// ========== Token 验证中间件 ==========
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return sendError(res, '未提供 Token，请先登录', 401);
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return sendError(res, 'Token 无效或已过期，请重新登录', 401);
    }

    req.user = decoded;
    next();
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 确保 uploads 目录存在
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ========== 文件上传配置 ==========
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('只允许上传图片文件'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 }
});

// ========== 邮件配置 ==========
const emailTransporter = nodemailer.createTransport({
    service: 'qq',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// 验证码存储
const resetCodeStore = new Map();

// ========== 静态文件服务 ==========
app.use('/uploads', express.static('uploads'));

// ========== 测试接口（无需登录） ==========
app.get('/hello', (req, res) => {
    sendSuccess(res, { message: 'Hello, 绿屿! 后端服务已启动' });
});

// ========== 用户相关接口 ==========

// 查询所有用户（需要管理员权限）
app.get('/api/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    try {
        const [rows] = await db.query('SELECT id, username, nickname, phone, email, role, credit, status, create_time FROM users');
        sendSuccess(res, rows);
    } catch (error) {
        console.error('查询用户失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// 注册接口（无需登录）
app.post('/api/register', async (req, res) => {
    const { username, nickname, phone, email, password } = req.body;

    if (!username || !nickname || !phone || !password) {
        return sendError(res, '请填写完整信息', 400);
    }

    if (password.length < 8) {
        return sendError(res, '密码长度不能少于8位', 400);
    }
    if (!/[A-Z]/.test(password)) {
        return sendError(res, '密码必须包含至少一个大写字母', 400);
    }
    if (!/[a-z]/.test(password)) {
        return sendError(res, '密码必须包含至少一个小写字母', 400);
    }
    if (!/[0-9]/.test(password)) {
        return sendError(res, '密码必须包含至少一个数字', 400);
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return sendError(res, '密码必须包含至少一个特殊字符 (!@#$%^&* 等)', 400);
    }

    try {
        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? OR phone = ?',
            [username, phone]
        );

        if (existing.length > 0) {
            return sendError(res, '用户名或手机号已注册', 409);
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const [result] = await db.query(
            'INSERT INTO users (username, nickname, phone, email, password, credit) VALUES (?, ?, ?, ?, ?, 80)',
            [username, nickname, phone, email || null, hashedPassword]
        );

        sendSuccess(res, { userId: result.insertId }, '注册成功');

    } catch (error) {
        console.error('注册失败:', error);
        sendError(res, '服务器错误', 500);
    }
});

// 登录接口（无需登录）
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return sendError(res, '请输入用户名和密码', 400);
    }

    try {
        const [users] = await db.query(
            'SELECT id, username, nickname, phone, email, password, role, credit, status FROM users WHERE username = ? OR phone = ?',
            [username, username]
        );

        if (users.length === 0) {
            return sendError(res, '用户名或密码错误', 401);
        }

        const user = users[0];

        if (user.status === '封禁') {
            return sendError(res, '账号已被封禁', 403);
        }

        const isPasswordValid = bcrypt.compareSync(password, user.password);
        if (!isPasswordValid) {
            return sendError(res, '用户名或密码错误', 401);
        }

        const token = generateToken(user);
        const { password: _, ...userInfo } = user;
        sendSuccess(res, { user: userInfo, token }, '登录成功');

    } catch (error) {
        console.error('登录失败:', error);
        sendError(res, '服务器错误', 500);
    }
});

// 修改手机号（需要登录）
app.put('/api/users/:id/phone', authenticateToken, async (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId !== req.user.userId) {
        return sendError(res, '只能修改自己的手机号', 403);
    }
    const { phone } = req.body;

    if (!phone) {
        return sendError(res, '手机号不能为空', 400);
    }

    if (!/^1[3-9]\d{9}$/.test(phone)) {
        return sendError(res, '手机号格式不正确', 400);
    }

    try {
        const [existing] = await db.query(
            'SELECT id FROM users WHERE phone = ? AND id != ?',
            [phone, userId]
        );

        if (existing.length > 0) {
            return sendError(res, '手机号已被其他用户使用', 409);
        }

        await db.query('UPDATE users SET phone = ? WHERE id = ?', [phone, userId]);
        sendSuccess(res, null, '手机号修改成功');
    } catch (error) {
        console.error('修改手机号失败:', error);
        sendError(res, '服务器错误', 500);
    }
});

// 修改密码（需要登录）
app.put('/api/users/:id/password', authenticateToken, async (req, res) => {
    const userId = parseInt(req.params.id);
    if (userId !== req.user.userId) {
        return sendError(res, '只能修改自己的密码', 403);
    }
    const { password } = req.body;

    if (!password) {
        return sendError(res, '密码不能为空', 400);
    }

    if (password.length < 8) {
        return sendError(res, '密码长度不能少于8位', 400);
    }
    if (!/[A-Z]/.test(password)) {
        return sendError(res, '密码必须包含至少一个大写字母', 400);
    }
    if (!/[a-z]/.test(password)) {
        return sendError(res, '密码必须包含至少一个小写字母', 400);
    }
    if (!/[0-9]/.test(password)) {
        return sendError(res, '密码必须包含至少一个数字', 400);
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return sendError(res, '密码必须包含至少一个特殊字符 (!@#$%^&* 等)', 400);
    }

    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        sendSuccess(res, null, '密码修改成功');
    } catch (error) {
        console.error('修改密码失败:', error);
        sendError(res, '服务器错误', 500);
    }
});

// ========== 忘记密码接口（无需登录） ==========

// 发送验证码
app.post('/api/forgot-password', async (req, res) => {
    const { account } = req.body;

    if (!account) {
        return sendError(res, '请输入用户名或手机号', 400);
    }

    try {
        const [users] = await db.query(
            'SELECT id, username, nickname, phone, email FROM users WHERE username = ? OR phone = ?',
            [account, account]
        );

        if (users.length === 0) {
            return sendError(res, '用户不存在', 404);
        }

        const user = users[0];

        if (!user.email) {
            return sendError(res, '该用户未绑定邮箱，请联系管理员', 400);
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();

        resetCodeStore.set(user.id, {
            code: code,
            expire: Date.now() + 10 * 60 * 1000
        });

        sendSuccess(res, { userId: user.id }, '验证码已发送');

        emailTransporter.sendMail({
            from: '2834574735@qq.com',
            to: user.email,
            subject: '绿屿二手 - 密码重置验证码',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fcf9; border-radius: 16px;">
                    <h2 style="color: #4caf7f; text-align: center;">🌿 绿屿二手交易平台</h2>
                    <h3 style="color: #333;">密码重置验证码</h3>
                    <p>您正在申请重置密码，验证码为：</p>
                    <div style="font-size: 32px; font-weight: bold; color: #4caf7f; text-align: center; padding: 20px; background: white; border-radius: 12px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>验证码有效期为10分钟，请勿泄露给他人。</p>
                    <hr style="border: none; border-top: 1px solid #e0ede6; margin: 20px 0;">
                    <p style="color: #999; font-size: 12px; text-align: center;">© 2026 绿屿二手交易平台</p>
                </div>
            `
        }).then(() => {
            console.log(`✅ 验证码已发送到 ${user.email}`);
        }).catch(err => {
            console.error('邮件发送失败:', err);
        });

    } catch (error) {
        console.error('发送验证码失败:', error);
        sendError(res, '发送失败，请稍后重试', 500);
    }
});

// 验证验证码
app.post('/api/verify-reset-code', async (req, res) => {
    const { userId, code } = req.body;

    if (!userId || !code) {
        return sendError(res, '参数不完整', 400);
    }

    const stored = resetCodeStore.get(parseInt(userId));

    if (!stored) {
        return sendError(res, '验证码已过期，请重新获取', 400);
    }

    if (stored.expire < Date.now()) {
        resetCodeStore.delete(parseInt(userId));
        return sendError(res, '验证码已过期，请重新获取', 400);
    }

    if (stored.code !== code) {
        return sendError(res, '验证码错误', 400);
    }

    resetCodeStore.delete(parseInt(userId));
    sendSuccess(res, null, '验证通过');
});

// 重置密码
app.post('/api/reset-password', async (req, res) => {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
        return sendError(res, '参数不完整', 400);
    }

    if (newPassword.length < 8) {
        return sendError(res, '密码长度不能少于8位', 400);
    }
    if (!/[A-Z]/.test(newPassword)) {
        return sendError(res, '密码必须包含至少一个大写字母', 400);
    }
    if (!/[a-z]/.test(newPassword)) {
        return sendError(res, '密码必须包含至少一个小写字母', 400);
    }
    if (!/[0-9]/.test(newPassword)) {
        return sendError(res, '密码必须包含至少一个数字', 400);
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
        return sendError(res, '密码必须包含至少一个特殊字符 (!@#$%^&* 等)', 400);
    }

    try {
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        await db.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        sendSuccess(res, null, '密码重置成功');

    } catch (error) {
        console.error('重置密码失败:', error);
        sendError(res, '服务器错误', 500);
    }
});

// ========== 商品相关接口 ==========

// 获取所有在售商品（无需登录，公开浏览）
app.get('/api/products', async (req, res) => {
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, seller_name, seller_id, status, stock, description, create_time FROM products WHERE status = "在售" ORDER BY create_time DESC'
        );
        sendSuccess(res, products);
    } catch (error) {
        console.error('查询商品失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// 获取所有商品（管理员用，需要登录+管理员权限）
app.get('/api/products/all', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, seller_name, seller_id, status, stock, description, create_time FROM products ORDER BY create_time DESC'
        );
        sendSuccess(res, products);
    } catch (error) {
        console.error('查询失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// 获取单个商品（无需登录，公开浏览）
app.get('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, seller_name, seller_id, status, stock, description, create_time FROM products WHERE id = ?',
            [productId]
        );
        if (products.length === 0) {
            return sendError(res, '商品不存在', 404);
        }
        sendSuccess(res, products[0]);
    } catch (error) {
        console.error('查询商品失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// 发布商品（需要登录）
app.post('/api/products', authenticateToken, async (req, res) => {
    const { title, category, description, price, stock, condition, images } = req.body;
    const sellerId = req.user.userId;
    const sellerName = req.user.username;

    if (!title || !category || !price || !stock || !condition) {
        return sendError(res, '请填写完整信息', 400);
    }

    try {
        const imageUrl = images && images.length > 0 ? images[0] : '📦';
        const [result] = await db.query(
            `INSERT INTO products
            (title, category, description, price, stock, \`condition\`, image, seller_id, seller_name, status, create_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '待审核', NOW())`,
            [title, category, description, price, stock, condition, imageUrl, sellerId, sellerName]
        );

        sendSuccess(res, { productId: result.insertId }, '商品发布成功');
    } catch (error) {
        console.error('发布商品失败:', error);
        sendError(res, '服务器错误', 500);
    }
});

// 编辑商品（需要登录）
app.put('/api/products/:id', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;
    const { title, category, description, price, stock, condition, images } = req.body;

    try {
        const [products] = await db.query(
            'SELECT seller_id FROM products WHERE id = ?',
            [productId]
        );
        if (products.length === 0) {
            return sendError(res, '商品不存在', 404);
        }
        if (products[0].seller_id !== userId && req.user.role !== 'admin') {
            return sendError(res, '只能编辑自己的商品', 403);
        }

        const imageUrl = images && images.length > 0 ? images[0] : '📦';
        await db.query(
            'UPDATE products SET title = ?, category = ?, description = ?, price = ?, stock = ?, `condition` = ?, image = ? WHERE id = ?',
            [title, category, description, price, stock, condition, imageUrl, productId]
        );
        sendSuccess(res, null, '商品已更新');
    } catch (error) {
        console.error('更新商品失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// 获取卖家商品列表（需要登录）
app.get('/api/my-products', authenticateToken, async (req, res) => {
    const sellerId = req.user.userId;
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, status, stock, create_time FROM products WHERE seller_id = ? ORDER BY create_time DESC',
            [sellerId]
        );
        sendSuccess(res, products);
    } catch (error) {
        console.error('查询商品失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// 下架商品（需要登录）
app.put('/api/products/:id/off', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;

    try {
        const [products] = await db.query(
            'SELECT seller_id FROM products WHERE id = ?',
            [productId]
        );
        if (products.length === 0) {
            return sendError(res, '商品不存在', 404);
        }
        if (products[0].seller_id !== userId && req.user.role !== 'admin') {
            return sendError(res, '只能下架自己的商品', 403);
        }

        await db.query('UPDATE products SET status = "已下架" WHERE id = ?', [productId]);
        sendSuccess(res, null, '商品已下架');
    } catch (error) {
        console.error('下架失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// 重新上架（需要登录）
app.put('/api/products/:id/on', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;

    try {
        const [products] = await db.query(
            'SELECT seller_id FROM products WHERE id = ?',
            [productId]
        );
        if (products.length === 0) {
            return sendError(res, '商品不存在', 404);
        }
        if (products[0].seller_id !== userId && req.user.role !== 'admin') {
            return sendError(res, '只能上架自己的商品', 403);
        }

        await db.query('UPDATE products SET status = "待审核" WHERE id = ?', [productId]);
        sendSuccess(res, null, '已提交审核');
    } catch (error) {
        console.error('上架失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// ========== 管理员审核接口（需要管理员权限） ==========

app.put('/api/products/:id/approve', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    const productId = req.params.id;
    try {
        await db.query('UPDATE products SET status = "在售" WHERE id = ?', [productId]);
        sendSuccess(res, null, '审核通过');
    } catch (error) {
        console.error('审核失败:', error);
        sendError(res, '操作失败', 500);
    }
});

app.put('/api/products/:id/reject', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    const productId = req.params.id;
    try {
        await db.query('UPDATE products SET status = "已下架" WHERE id = ?', [productId]);
        sendSuccess(res, null, '已驳回');
    } catch (error) {
        console.error('驳回失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// ========== 购物车接口（需要登录） ==========

app.get('/api/cart', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const [items] = await db.query(
            'SELECT c.id, c.product_id, c.quantity, c.selected, p.title, p.price, p.image, p.stock, p.seller_id, p.seller_name FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?',
            [userId]
        );
        sendSuccess(res, items);
    } catch (error) {
        console.error('查询购物车失败:', error);
        sendError(res, '查询失败', 500);
    }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
        return sendError(res, '缺少商品ID', 400);
    }

    try {
        const [existing] = await db.query(
            'SELECT id, quantity FROM cart WHERE user_id = ? AND product_id = ?',
            [userId, productId]
        );
        if (existing.length > 0) {
            await db.query('UPDATE cart SET quantity = quantity + ? WHERE id = ?', [quantity, existing[0].id]);
        } else {
            await db.query('INSERT INTO cart (user_id, product_id, quantity, selected) VALUES (?, ?, ?, 0)', [userId, productId, quantity]);
        }
        sendSuccess(res, null, '已添加到购物车');
    } catch (error) {
        console.error('添加购物车失败:', error);
        sendError(res, '操作失败', 500);
    }
});

app.put('/api/cart/:id', authenticateToken, async (req, res) => {
    const cartId = req.params.id;
    const userId = req.user.userId;
    const { quantity, selected } = req.body;

    try {
        const [items] = await db.query(
            'SELECT user_id FROM cart WHERE id = ?',
            [cartId]
        );
        if (items.length === 0) {
            return sendError(res, '购物车项不存在', 404);
        }
        if (items[0].user_id !== userId) {
            return sendError(res, '只能操作自己的购物车', 403);
        }

        if (quantity !== undefined) {
            await db.query('UPDATE cart SET quantity = ? WHERE id = ?', [quantity, cartId]);
        }
        if (selected !== undefined) {
            await db.query('UPDATE cart SET selected = ? WHERE id = ?', [selected ? 1 : 0, cartId]);
        }
        sendSuccess(res, null, '已更新');
    } catch (error) {
        console.error('更新购物车失败:', error);
        sendError(res, '操作失败', 500);
    }
});

app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
    const cartId = req.params.id;
    const userId = req.user.userId;

    try {
        const [items] = await db.query(
            'SELECT user_id FROM cart WHERE id = ?',
            [cartId]
        );
        if (items.length === 0) {
            return sendError(res, '购物车项不存在', 404);
        }
        if (items[0].user_id !== userId) {
            return sendError(res, '只能删除自己的购物车项', 403);
        }

        await db.query('DELETE FROM cart WHERE id = ?', [cartId]);
        sendSuccess(res, null, '已删除');
    } catch (error) {
        console.error('删除购物车失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// ========== 订单接口（需要登录） ==========

app.get('/api/orders', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const role = req.query.role || 'buyer';

    try {
        let sql = 'SELECT o.*, p.title, p.image FROM orders o JOIN products p ON o.product_id = p.id WHERE ';
        if (role === 'seller') {
            sql += 'o.seller_id = ?';
        } else {
            sql += 'o.buyer_id = ?';
        }
        sql += ' ORDER BY o.create_time DESC';
        const [orders] = await db.query(sql, [userId]);
        sendSuccess(res, orders);
    } catch (error) {
        console.error('查询订单失败:', error);
        sendError(res, '查询失败', 500);
    }
});

app.post('/api/orders', authenticateToken, async (req, res) => {
    const buyerId = req.user.userId;
    const buyerName = req.user.username;
    const { sellerId, productId, address, totalAmount } = req.body;

    if (!sellerId || !productId) {
        return sendError(res, '缺少参数', 400);
    }

    try {
        const [result] = await db.query(
            'INSERT INTO orders (buyer_id, buyer_name, seller_id, product_id, address, total_amount, status, create_time) VALUES (?, ?, ?, ?, ?, ?, "待付款", NOW())',
            [buyerId, buyerName, sellerId, productId, address || '', totalAmount || 0]
        );
        await db.query('DELETE FROM cart WHERE user_id = ? AND product_id = ?', [buyerId, productId]);
        await db.query('UPDATE products SET stock = stock - 1 WHERE id = ?', [productId]);
        sendSuccess(res, { orderId: result.insertId }, '订单创建成功');
    } catch (error) {
        console.error('创建订单失败:', error);
        sendError(res, '操作失败', 500);
    }
});

app.put('/api/orders/:id', authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.userId;
    const { status, expressNo } = req.body;

    try {
        const [orders] = await db.query(
            'SELECT buyer_id, seller_id FROM orders WHERE id = ?',
            [orderId]
        );
        if (orders.length === 0) {
            return sendError(res, '订单不存在', 404);
        }
        const order = orders[0];
        if (order.buyer_id !== userId && order.seller_id !== userId) {
            return sendError(res, '只能操作自己的订单', 403);
        }

        if (expressNo !== undefined) {
            await db.query('UPDATE orders SET status = ?, express_no = ? WHERE id = ?', [status, expressNo, orderId]);
        } else {
            await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
        }
        sendSuccess(res, null, '状态已更新');
    } catch (error) {
        console.error('更新订单失败:', error);
        sendError(res, '操作失败', 500);
    }
});

app.put('/api/orders/:id/cancel', authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.userId;

    try {
        const [orders] = await db.query(
            'SELECT buyer_id, product_id FROM orders WHERE id = ?',
            [orderId]
        );
        if (orders.length === 0) {
            return sendError(res, '订单不存在', 404);
        }
        if (orders[0].buyer_id !== userId) {
            return sendError(res, '只能取消自己的订单', 403);
        }

        await db.query('UPDATE orders SET status = "已取消" WHERE id = ?', [orderId]);
        await db.query('UPDATE products SET stock = stock + 1 WHERE id = ?', [orders[0].product_id]);
        sendSuccess(res, null, '订单已取消');
    } catch (error) {
        console.error('取消订单失败:', error);
        sendError(res, '操作失败', 500);
    }
});

app.put('/api/orders/:id/refund', authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.userId;
    const { action } = req.body;

    try {
        const [orders] = await db.query(
            'SELECT buyer_id, product_id, status FROM orders WHERE id = ?',
            [orderId]
        );
        if (orders.length === 0) {
            return sendError(res, '订单不存在', 404);
        }
        if (orders[0].buyer_id !== userId && req.user.role !== 'admin') {
            return sendError(res, '只能操作自己的订单', 403);
        }
        if (orders[0].status !== '退款中') {
            return sendError(res, '当前订单状态不支持退款操作', 400);
        }

        if (action === 'confirm') {
            await db.query('UPDATE orders SET status = "已退款" WHERE id = ?', [orderId]);
            await db.query('UPDATE products SET stock = stock + 1 WHERE id = ?', [orders[0].product_id]);
        } else if (action === 'reject') {
            await db.query('UPDATE orders SET status = "待发货" WHERE id = ?', [orderId]);
        } else {
            return sendError(res, '无效的操作参数', 400);
        }
        sendSuccess(res, null, '处理成功');
    } catch (error) {
        console.error('退款处理失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// ========== 图片上传接口（需要登录） ==========

app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return sendError(res, '没有上传文件', 400);
        }
        const imageUrl = `/uploads/${req.file.filename}`;
        sendSuccess(res, { url: imageUrl }, '上传成功');
    } catch (error) {
        console.error('上传失败:', error);
        sendError(res, '上传失败', 500);
    }
});

app.post('/api/upload-multiple', authenticateToken, upload.array('images', 9), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return sendError(res, '没有上传文件', 400);
        }
        const urls = req.files.map(file => `/uploads/${file.filename}`);
        sendSuccess(res, { urls: urls }, '上传成功');
    } catch (error) {
        console.error('上传失败:', error);
        sendError(res, '上传失败', 500);
    }
});

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
});