const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// ========== 统一响应格式 ==========
function sendSuccess(res, data, message = '操作成功') {
    res.json({ success: true, message, data });
}

function sendError(res, message = '操作失败', status = 400) {
    res.status(status).json({ success: false, message });
}

// ========== JWT 生成 ==========
function generateToken(user) {
    return jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

// ========== 注册 ==========
router.post('/register', async (req, res) => {
    const { username, nickname, phone, email, password } = req.body;

    if (!username || !nickname || !phone || !password) {
        return sendError(res, '请填写完整信息', 400);
    }

    // 密码强度校验
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

// ========== 登录 ==========
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    console.log('📥 收到登录请求:', { username, password });

    if (!username || !password) {
        return sendError(res, '请输入用户名和密码', 400);
    }

    try {
        const [users] = await db.query(
            'SELECT id, username, nickname, phone, email, password, role, credit, status FROM users WHERE username = ? OR phone = ?',
            [username, username]
        );

        console.log('📊 查询到用户数量:', users.length);

        if (users.length === 0) {
            console.log('❌ 用户不存在:', username);
            return sendError(res, '用户名或密码错误', 401);
        }

        const user = users[0];
        console.log('👤 找到用户:', { id: user.id, username: user.username, role: user.role });
        console.log('🔑 数据库密码哈希:', user.password);
        console.log('🔑 输入明文密码:', password);

        if (user.status === '封禁') {
            console.log('❌ 账号已被封禁');
            return sendError(res, '账号已被封禁', 403);
        }

        const isPasswordValid = bcrypt.compareSync(password, user.password);
        console.log('✅ bcrypt.compareSync 比对结果:', isPasswordValid);

        if (!isPasswordValid) {
            console.log('❌ 密码比对失败');
            return sendError(res, '用户名或密码错误', 401);
        }

        console.log('✅ 登录成功!');
        const token = generateToken(user);
        const { password: _, ...userInfo } = user;
        sendSuccess(res, { user: userInfo, token }, '登录成功');
    } catch (error) {
        console.error('❌ 登录失败:', error);
        sendError(res, '服务器错误', 500);
    }
});
// ========== 查询所有用户（管理员） ==========
router.get('/users', async (req, res) => {
    // 这个需要管理员权限，我们在 server.js 中统一处理
    try {
        const [rows] = await db.query('SELECT id, username, nickname, phone, email, role, credit, status, create_time FROM users');
        sendSuccess(res, rows);
    } catch (error) {
        console.error('查询用户失败:', error);
        sendError(res, '查询失败', 500);
    }
});

module.exports = router;