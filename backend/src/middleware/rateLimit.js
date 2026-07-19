const rateLimit = require('express-rate-limit');

// 登录限流：15分钟内最多5次
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: '请求过于频繁，请15分钟后再试' }
});

// 发布商品限流：10分钟内最多3次
const publishLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: { success: false, message: '发布过于频繁，请10分钟后再试' }
});

// 通用限流：1分钟内最多100次
const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { success: false, message: '请求过于频繁，请稍后再试' }
});

module.exports = {
    loginLimiter,
    publishLimiter,
    generalLimiter
};