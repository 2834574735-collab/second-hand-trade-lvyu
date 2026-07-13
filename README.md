# 🌿 绿屿二手交易平台

> 一个基于 Node.js + Express + MySQL 的全栈 Web 应用，实现校园二手物品发布、浏览、购物车和订单管理功能。

## 🛠 技术栈
- **后端**：Node.js + Express + MySQL（mysql2/promise）
- **前端**：原生 HTML + CSS + JavaScript（Ajax）
- **其他**：Nodemailer（邮件服务）、Multer（文件上传）、dotenv（环境变量）

## ✨ 核心功能
- 用户注册/登录（含手机号格式校验）
- 商品发布（带图片上传，支持多图）
- 商品列表展示与分类筛选
- 购物车管理（增删改查 + 选中状态）
- 订单生成与状态流转（待付款 → 待发货 → 已完成）
- 邮箱验证码找回密码（含 10 分钟有效期）
- 管理员审核商品上下架

## 🚀 本地运行

1. 导入数据库：`database/lvyuSQL.sql`
2. 进入后端目录：`cd backend`
3. 安装依赖：`npm install`
4. 配置 `.env` 文件（参考下方）
5. 启动服务：`node server.js`

### `.env` 配置示例
MYSQL_URL=mysql://root:你的密码@localhost:3306/second_hand_trade
EMAIL_USER=你的QQ邮箱@qq.com
EMAIL_PASS=你的邮箱授权码
PORT=3000

