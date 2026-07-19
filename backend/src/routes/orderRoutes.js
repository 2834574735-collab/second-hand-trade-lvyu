const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

function sendSuccess(res, data, message = '操作成功') {
    res.json({ success: true, message, data });
}
function sendError(res, message = '操作失败', status = 400) {
    res.status(status).json({ success: false, message });
}

// ========== 获取订单列表 ==========
router.get('/orders', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const role = req.query.role || 'buyer';

    try {
        let sql = `SELECT o.*, p.title, p.image FROM orders o JOIN products p ON o.product_id = p.id WHERE `;
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

// ========== 创建订单 ==========
router.post('/orders', authenticateToken, async (req, res) => {
    const buyerId = req.user.userId;
    const buyerName = req.user.username;
    const { sellerId, productId, address, totalAmount } = req.body;

    if (!sellerId || !productId) {
        return sendError(res, '缺少参数', 400);
    }

    try {
        const [result] = await db.query(
            `INSERT INTO orders 
            (buyer_id, buyer_name, seller_id, product_id, address, total_amount, status, create_time) 
            VALUES (?, ?, ?, ?, ?, ?, '待付款', NOW())`,
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

// ========== 更新订单状态 ==========
router.put('/orders/:id', authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.userId;
    const { status, expressNo } = req.body;

    try {
        const [orders] = await db.query('SELECT buyer_id, seller_id FROM orders WHERE id = ?', [orderId]);
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

// ========== 取消订单 ==========
router.put('/orders/:id/cancel', authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.userId;

    try {
        const [orders] = await db.query('SELECT buyer_id, product_id FROM orders WHERE id = ?', [orderId]);
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

// ========== 处理退款 ==========
router.put('/orders/:id/refund', authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    const userId = req.user.userId;
    const { action } = req.body;

    try {
        const [orders] = await db.query('SELECT buyer_id, product_id, status FROM orders WHERE id = ?', [orderId]);
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

module.exports = router;