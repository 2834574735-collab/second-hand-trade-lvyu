const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// ========== 统一响应 ==========
function sendSuccess(res, data, message = '操作成功') {
    res.json({ success: true, message, data });
}
function sendError(res, message = '操作失败', status = 400) {
    res.status(status).json({ success: false, message });
}

// ========== 获取所有在售商品（公开） ==========
router.get('/products', async (req, res) => {
    try {
        const [products] = await db.query(
            `SELECT id, title, price, \`condition\`, category, image, 
                    seller_name, seller_id, status, stock, description, create_time 
             FROM products WHERE status = "在售" ORDER BY create_time DESC`
        );
        sendSuccess(res, products);
    } catch (error) {
        console.error('查询商品失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// ========== 获取所有商品（管理员） ==========
router.get('/products/all', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    try {
        const [products] = await db.query(
            `SELECT id, title, price, \`condition\`, category, image, 
                    seller_name, seller_id, status, stock, description, create_time 
             FROM products ORDER BY create_time DESC`
        );
        sendSuccess(res, products);
    } catch (error) {
        console.error('查询失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// ========== 获取单个商品（公开） ==========
router.get('/products/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        const [products] = await db.query(
            `SELECT id, title, price, \`condition\`, category, image, 
                    seller_name, seller_id, status, stock, description, create_time 
             FROM products WHERE id = ?`,
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

// ========== 发布商品（需要登录 + 限流） ==========
router.post('/products', authenticateToken, async (req, res) => {
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

// ========== 编辑商品 ==========
router.put('/products/:id', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;
    const { title, category, description, price, stock, condition, images } = req.body;

    try {
        const [products] = await db.query('SELECT seller_id FROM products WHERE id = ?', [productId]);
        if (products.length === 0) {
            return sendError(res, '商品不存在', 404);
        }
        if (products[0].seller_id !== userId && req.user.role !== 'admin') {
            return sendError(res, '只能编辑自己的商品', 403);
        }

        const imageUrl = images && images.length > 0 ? images[0] : '📦';
        await db.query(
            `UPDATE products SET title = ?, category = ?, description = ?, price = ?, 
             stock = ?, \`condition\` = ?, image = ? WHERE id = ?`,
            [title, category, description, price, stock, condition, imageUrl, productId]
        );
        sendSuccess(res, null, '商品已更新');
    } catch (error) {
        console.error('更新商品失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// ========== 获取卖家商品列表 ==========
router.get('/my-products', authenticateToken, async (req, res) => {
    const sellerId = req.user.userId;
    try {
        const [products] = await db.query(
            `SELECT id, title, price, \`condition\`, category, image, status, stock, create_time 
             FROM products WHERE seller_id = ? ORDER BY create_time DESC`,
            [sellerId]
        );
        sendSuccess(res, products);
    } catch (error) {
        console.error('查询商品失败:', error);
        sendError(res, '查询失败', 500);
    }
});

// ========== 下架商品 ==========
router.put('/products/:id/off', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;

    try {
        const [products] = await db.query('SELECT seller_id FROM products WHERE id = ?', [productId]);
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

// ========== 重新上架 ==========
router.put('/products/:id/on', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;

    try {
        const [products] = await db.query('SELECT seller_id FROM products WHERE id = ?', [productId]);
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

// ========== 管理员审核通过 ==========
router.put('/products/:id/approve', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    try {
        await db.query('UPDATE products SET status = "在售" WHERE id = ?', [req.params.id]);
        sendSuccess(res, null, '审核通过');
    } catch (error) {
        console.error('审核失败:', error);
        sendError(res, '操作失败', 500);
    }
});

// ========== 管理员审核驳回 ==========
router.put('/products/:id/reject', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return sendError(res, '权限不足，需要管理员权限', 403);
    }
    try {
        await db.query('UPDATE products SET status = "已下架" WHERE id = ?', [req.params.id]);
        sendSuccess(res, null, '已驳回');
    } catch (error) {
        console.error('驳回失败:', error);
        sendError(res, '操作失败', 500);
    }
});

module.exports = router;