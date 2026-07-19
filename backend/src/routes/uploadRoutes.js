const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authenticateToken = require('../middleware/auth');

function sendSuccess(res, data, message = '操作成功') {
    res.json({ success: true, message, data });
}
function sendError(res, message = '操作失败', status = 400) {
    res.status(status).json({ success: false, message });
}

// ========== 确保 uploads 目录存在 ==========
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ========== 文件上传配置 ==========
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
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

// ========== 单图上传 ==========
router.post('/upload', authenticateToken, upload.single('image'), (req, res) => {
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

// ========== 多图上传 ==========
router.post('/upload-multiple', authenticateToken, upload.array('images', 9), (req, res) => {
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

module.exports = router;