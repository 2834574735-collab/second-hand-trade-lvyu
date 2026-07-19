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

// ========== 获取购物车 ==========
router.get('/cart', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const [items] = await db.query(
            `SELECT c.id, c.product_id, c.quantity, c.selected, 
                    p.title, p.price, p.image, p.stock, p.seller_id, p.seller_name 
             FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?`,
            [userId]
        );
        sendSuccess(res, items);
    } catch (error) {
        console.error('查询购物车失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// ========== 添加到购物车 ==========
router.post('/cart', authenticateToken, async (req, res) => {
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

// ========== 更新购物车 ==========
router.put('/cart/:id', authenticateToken, async (req, res) => {
    const cartId = req.params.id;
    const userId = req.user.userId;
    const { quantity, selected } = req.body;

    try {
        const [items] = await db.query('SELECT user_id FROM cart WHERE id = ?', [cartId]);
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

// ========== 删除购物车项 ==========
router.delete('/cart/:id', authenticateToken, async (req, res) => {
    const cartId = req.params.id;
    const userId = req.user.userId;

    try {
        const [items] = await db.query('SELECT user_id FROM cart WHERE id = ?', [cartId]);
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

module.exports = router;