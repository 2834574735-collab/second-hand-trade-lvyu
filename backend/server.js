require('dotenv').config();
const bcrypt =require('bcryptjs');
const express = require('express');
const cors = require('cors');
const db = require('./src/config/db');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

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

// ========== 测试接口 ==========
app.get('/hello', (req, res) => {
    res.json({ message: 'Hello, 绿屿! 后端服务已启动' });
});

// ========== 用户相关接口 ==========

// 查询所有用户
app.get('/api/users', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, username, nickname, phone, email, role, credit, status, create_time FROM users');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('查询用户失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

// 注册接口
app.post('/api/register', async (req, res) => {
    const { username, nickname, phone, email, password } = req.body;

    // 1. 基础字段校验
    if (!username || !nickname || !phone || !password) {
        return res.status(400).json({ success: false, message: '请填写完整信息' });
    }

    // 2. L2：密码强度校验
    if (password.length < 8) {
        return res.status(400).json({ success: false, message: '密码长度不能少于8位' });
    }
    if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个大写字母' });
    }
    if (!/[a-z]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个小写字母' });
    }
    if (!/[0-9]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个数字' });
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个特殊字符 (!@#$%^&* 等)' });
    }

    try {
        // 3. 防重放攻击 - 检查用户名/手机号是否已存在
        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? OR phone = ?',
            [username, phone]
        );

        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: '用户名或手机号已注册' });
        }

        // 4. 密码哈希加密
        const hashedPassword = bcrypt.hashSync(password, 10);

        const [result] = await db.query(
            'INSERT INTO users (username, nickname, phone, email, password, credit) VALUES (?, ?, ?, ?, ?, 80)',
            [username, nickname, phone, email || null, hashedPassword]
        );

        res.json({ success: true, message: '注册成功', userId: result.insertId });

    } catch (error) {
        console.error('注册失败:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 登录接口
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: '请输入用户名和密码' });
    }

    try {
        const [users] = await db.query(
            'SELECT id, username, nickname, phone, email, password, role, credit, status FROM users WHERE username = ? OR phone = ?',
            [username, username]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }

        const user = users[0];

        if (user.status === '封禁') {
            return res.status(403).json({ success: false, message: '账号已被封禁' });
        }

        // 使用 bcrypt 比对密码
        const isPasswordValid = bcrypt.compareSync(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: '用户名或密码错误' });
        }

        const { password: _, ...userInfo } = user;
        res.json({ success: true, message: '登录成功', user: userInfo });

    } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 修改手机号
app.put('/api/users/:id/phone', async (req, res) => {
    const userId = req.params.id;
    const { phone } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, message: '手机号不能为空' });
    }
    
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ success: false, message: '手机号格式不正确' });
    }
    
    try {
        const [existing] = await db.query(
            'SELECT id FROM users WHERE phone = ? AND id != ?',
            [phone, userId]
        );
        
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: '手机号已被其他用户使用' });
        }
        
        await db.query('UPDATE users SET phone = ? WHERE id = ?', [phone, userId]);
        res.json({ success: true, message: '手机号修改成功' });
    } catch (error) {
        console.error('修改手机号失败:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 修改密码
app.put('/api/users/:id/password', async (req, res) => {
    const userId = req.params.id;
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ success: false, message: '密码不能为空' });
    }

    // L2：密码强度校验
    if (password.length < 8) {
        return res.status(400).json({ success: false, message: '密码长度不能少于8位' });
    }
    if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个大写字母' });
    }
    if (!/[a-z]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个小写字母' });
    }
    if (!/[0-9]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个数字' });
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个特殊字符 (!@#$%^&* 等)' });
    }

    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        res.json({ success: true, message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码失败:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 忘记密码接口 ==========

// 发送验证码
app.post('/api/forgot-password', async (req, res) => {
    const { account } = req.body;
    
    if (!account) {
        return res.status(400).json({ success: false, message: '请输入用户名或手机号' });
    }
    
    try {
        const [users] = await db.query(
            'SELECT id, username, nickname, phone, email FROM users WHERE username = ? OR phone = ?',
            [account, account]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        const user = users[0];
        
        if (!user.email) {
            return res.status(400).json({ success: false, message: '该用户未绑定邮箱，请联系管理员' });
        }
        
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        resetCodeStore.set(user.id, {
            code: code,
            expire: Date.now() + 10 * 60 * 1000
        });
        
        // 异步发送邮件
        res.json({ success: true, message: '验证码已发送', userId: user.id });
        
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
        res.status(500).json({ success: false, message: '发送失败，请稍后重试' });
    }
});

// 验证验证码
app.post('/api/verify-reset-code', async (req, res) => {
    const { userId, code } = req.body;
    
    if (!userId || !code) {
        return res.status(400).json({ success: false, message: '参数不完整' });
    }
    
    const stored = resetCodeStore.get(parseInt(userId));
    
    if (!stored) {
        return res.status(400).json({ success: false, message: '验证码已过期，请重新获取' });
    }
    
    if (stored.expire < Date.now()) {
        resetCodeStore.delete(parseInt(userId));
        return res.status(400).json({ success: false, message: '验证码已过期，请重新获取' });
    }
    
    if (stored.code !== code) {
        return res.status(400).json({ success: false, message: '验证码错误' });
    }
    
    resetCodeStore.delete(parseInt(userId));
    res.json({ success: true, message: '验证通过' });
});

// 重置密码
app.post('/api/reset-password', async (req, res) => {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
        return res.status(400).json({ success: false, message: '参数不完整' });
    }

    // L2：密码强度校验
    if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: '密码长度不能少于8位' });
    }
    if (!/[A-Z]/.test(newPassword)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个大写字母' });
    }
    if (!/[a-z]/.test(newPassword)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个小写字母' });
    }
    if (!/[0-9]/.test(newPassword)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个数字' });
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
        return res.status(400).json({ success: false, message: '密码必须包含至少一个特殊字符 (!@#$%^&* 等)' });
    }

    try {
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        await db.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        res.json({ success: true, message: '密码重置成功' });

    } catch (error) {
        console.error('重置密码失败:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 商品相关接口 ==========

// 获取所有在售商品
app.get('/api/products', async (req, res) => {
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, seller_name, seller_id, status, stock, description, create_time FROM products WHERE status = "在售" ORDER BY create_time DESC'
        );
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('查询商品失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

// 获取所有商品（管理员用）
app.get('/api/products/all', async (req, res) => {
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, seller_name, seller_id, status, stock, description, create_time FROM products ORDER BY create_time DESC'
        );
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('查询失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

// 获取单个商品
app.get('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, seller_name, seller_id, status, stock, description, create_time FROM products WHERE id = ?',
            [productId]
        );
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: '商品不存在' });
        }
        res.json({ success: true, data: products[0] });
    } catch (error) {
        console.error('查询商品失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

// 发布商品
app.post('/api/products', async (req, res) => {
    const { title, category, description, price, stock, condition, images, sellerId, sellerName } = req.body;

    if (!title || !category || !price || !stock || !condition) {
        return res.status(400).json({ success: false, message: '请填写完整信息' });
    }

    try {
        const imageUrl = images && images.length > 0 ? images[0] : '📦';
        const [result] = await db.query(
            `INSERT INTO products
            (title, category, description, price, stock, \`condition\`, image, seller_id, seller_name, status, create_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '待审核', NOW())`,
            [title, category, description, price, stock, condition, imageUrl, sellerId, sellerName]
        );

        res.json({ success: true, message: '商品发布成功', productId: result.insertId });
    } catch (error) {
        console.error('发布商品失败:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 编辑商品
app.put('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    const { title, category, description, price, stock, condition, images } = req.body;

    try {
        const imageUrl = images && images.length > 0 ? images[0] : '📦';
        await db.query(
            'UPDATE products SET title = ?, category = ?, description = ?, price = ?, stock = ?, `condition` = ?, image = ? WHERE id = ?',
            [title, category, description, price, stock, condition, imageUrl, productId]
        );
        res.json({ success: true, message: '商品已更新' });
    } catch (error) {
        console.error('更新商品失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

// 获取卖家商品列表
app.get('/api/my-products', async (req, res) => {
    const sellerId = req.query.sellerId;
    if (!sellerId) {
        return res.status(400).json({ success: false, message: '缺少卖家ID' });
    }

    try {
        const [products] = await db.query(
            'SELECT id, title, price, `condition`, category, image, status, stock, create_time FROM products WHERE seller_id = ? ORDER BY create_time DESC',
            [sellerId]
        );
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('查询商品失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

// 下架商品
app.put('/api/products/:id/off', async (req, res) => {
    const productId = req.params.id;
    try {
        await db.query('UPDATE products SET status = "已下架" WHERE id = ?', [productId]);
        res.json({ success: true, message: '商品已下架' });
    } catch (error) {
        console.error('下架失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

// 重新上架
app.put('/api/products/:id/on', async (req, res) => {
    const productId = req.params.id;
    try {
        await db.query('UPDATE products SET status = "待审核" WHERE id = ?', [productId]);
        res.json({ success: true, message: '已提交审核' });
    } catch (error) {
        console.error('上架失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

// ========== 管理员审核接口 ==========

app.put('/api/products/:id/approve', async (req, res) => {
    const productId = req.params.id;
    try {
        await db.query('UPDATE products SET status = "在售" WHERE id = ?', [productId]);
        res.json({ success: true, message: '审核通过' });
    } catch (error) {
        console.error('审核失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

app.put('/api/products/:id/reject', async (req, res) => {
    const productId = req.params.id;
    try {
        await db.query('UPDATE products SET status = "已下架" WHERE id = ?', [productId]);
        res.json({ success: true, message: '已驳回' });
    } catch (error) {
        console.error('驳回失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

// ========== 购物车接口 ==========

app.get('/api/cart', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ success: false, message: '缺少用户ID' });
    }
    try {
        const [items] = await db.query(
            'SELECT c.id, c.product_id, c.quantity, c.selected, p.title, p.price, p.image, p.stock, p.seller_id, p.seller_name FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?',
            [userId]
        );
        res.json({ success: true, data: items });
    } catch (error) {
        console.error('查询购物车失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

app.post('/api/cart', async (req, res) => {
    const { userId, productId, quantity = 1 } = req.body;
    if (!userId || !productId) {
        return res.status(400).json({ success: false, message: '缺少参数' });
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
        res.json({ success: true, message: '已添加到购物车' });
    } catch (error) {
        console.error('添加购物车失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

app.put('/api/cart/:id', async (req, res) => {
    const cartId = req.params.id;
    const { quantity, selected } = req.body;
    try {
        if (quantity !== undefined) {
            await db.query('UPDATE cart SET quantity = ? WHERE id = ?', [quantity, cartId]);
        }
        if (selected !== undefined) {
            await db.query('UPDATE cart SET selected = ? WHERE id = ?', [selected ? 1 : 0, cartId]);
        }
        res.json({ success: true, message: '已更新' });
    } catch (error) {
        console.error('更新购物车失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

app.delete('/api/cart/:id', async (req, res) => {
    const cartId = req.params.id;
    try {
        await db.query('DELETE FROM cart WHERE id = ?', [cartId]);
        res.json({ success: true, message: '已删除' });
    } catch (error) {
        console.error('删除购物车失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

// ========== 订单接口 ==========

app.get('/api/orders', async (req, res) => {
    const userId = req.query.userId;
    const role = req.query.role;
    if (!userId) {
        return res.status(400).json({ success: false, message: '缺少用户ID' });
    }
    try {
        let sql = 'SELECT o.*, p.title, p.image FROM orders o JOIN products p ON o.product_id = p.id WHERE ';
        if (role === 'seller') {
            sql += 'o.seller_id = ?';
        } else {
            sql += 'o.buyer_id = ?';
        }
        sql += ' ORDER BY o.create_time DESC';
        const [orders] = await db.query(sql, [userId]);
        res.json({ success: true, data: orders });
    } catch (error) {
        console.error('查询订单失败:', error);
        res.status(500).json({ success: false, message: '查询失败' });
    }
});

app.post('/api/orders', async (req, res) => {
    const { buyerId, buyerName, sellerId, productId, address, totalAmount } = req.body;
    if (!buyerId || !sellerId || !productId) {
        return res.status(400).json({ success: false, message: '缺少参数' });
    }
    try {
        const [result] = await db.query(
            'INSERT INTO orders (buyer_id, buyer_name, seller_id, product_id, address, total_amount, status, create_time) VALUES (?, ?, ?, ?, ?, ?, "待付款", NOW())',
            [buyerId, buyerName, sellerId, productId, address || '', totalAmount || 0]
        );
        await db.query('DELETE FROM cart WHERE user_id = ? AND product_id = ?', [buyerId, productId]);
        await db.query('UPDATE products SET stock = stock - 1 WHERE id = ?', [productId]);
        res.json({ success: true, message: '订单创建成功', orderId: result.insertId });
    } catch (error) {
        console.error('创建订单失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

app.put('/api/orders/:id', async (req, res) => {
    const orderId = req.params.id;
    const { status, expressNo } = req.body;
    try {
        if (expressNo !== undefined) {
            await db.query('UPDATE orders SET status = ?, express_no = ? WHERE id = ?', [status, expressNo, orderId]);
        } else {
            await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
        }
        res.json({ success: true, message: '状态已更新' });
    } catch (error) {
        console.error('更新订单失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

app.put('/api/orders/:id/cancel', async (req, res) => {
    const orderId = req.params.id;
    try {
        const [orders] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: '订单不存在' });
        }
        await db.query('UPDATE orders SET status = "已取消" WHERE id = ?', [orderId]);
        await db.query('UPDATE products SET stock = stock + 1 WHERE id = ?', [orders[0].product_id]);
        res.json({ success: true, message: '订单已取消' });
    } catch (error) {
        console.error('取消订单失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

app.put('/api/orders/:id/refund', async (req, res) => {
    const orderId = req.params.id;
    const { action } = req.body;
    try {
        const [orders] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: '订单不存在' });
        }
        if (action === 'confirm') {
            await db.query('UPDATE orders SET status = "已退款" WHERE id = ?', [orderId]);
            await db.query('UPDATE products SET stock = stock + 1 WHERE id = ?', [orders[0].product_id]);
        } else if (action === 'reject') {
            await db.query('UPDATE orders SET status = "待发货" WHERE id = ?', [orderId]);
        }
        res.json({ success: true, message: '处理成功' });
    } catch (error) {
        console.error('退款处理失败:', error);
        res.status(500).json({ success: false, message: '操作失败' });
    }
});

// ========== 图片上传接口 ==========

app.post('/api/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '没有上传文件' });
        }
        const imageUrl = `/uploads/${req.file.filename}`;
        res.json({ success: true, url: imageUrl, message: '上传成功' });
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ success: false, message: '上传失败' });
    }
});

app.post('/api/upload-multiple', upload.array('images', 9), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: '没有上传文件' });
        }
        const urls = req.files.map(file => `/uploads/${file.filename}`);
        res.json({ success: true, urls: urls, message: '上传成功' });
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ success: false, message: '上传失败' });
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
});