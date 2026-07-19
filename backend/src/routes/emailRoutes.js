const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const db = require('../config/db');
const bcrypt = require('bcryptjs');

function sendSuccess(res, data, message = '操作成功') {
    res.json({ success: true, message, data });
}
function sendError(res, message = '操作失败', status = 400) {
    res.status(status).json({ success: false, message });
}

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

// ========== 发送验证码 ==========
router.post('/forgot-password', async (req, res) => {
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
            from: process.env.EMAIL_USER,
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

// ========== 验证验证码 ==========
router.post('/verify-reset-code', async (req, res) => {
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

// ========== 重置密码 ==========
router.post('/reset-password', async (req, res) => {
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

module.exports = router;