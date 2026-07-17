// frontend/js/request.js

// ========== API 基础地址 ==========
const API_BASE = 'http://localhost:3000/api';

// ========== 统一请求函数 ==========
function request(url, options = {}) {
    // 从 localStorage 获取 Token
    const token = localStorage.getItem('token');

    // 默认配置
    const config = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        ...options,
    };

    // 如果有 Token，自动添加到请求头
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }

    // 如果是 POST/PUT/PATCH，自动序列化 body
    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    return fetch(`${API_BASE}${url}`, config)
        .then(res => res.json())
        .then(data => {
            // 统一错误处理：Token 失效跳转登录
            if (data.message === '未提供 Token，请先登录' ||
                data.message === 'Token 无效或已过期，请重新登录') {
                localStorage.removeItem('token');
                localStorage.removeItem('currentUser');
                window.location.href = 'login.html';
                return Promise.reject(new Error('请重新登录'));
            }

            if (!data.success) {
                return Promise.reject(new Error(data.message || '请求失败'));
            }

            return data;
        });
}

// ========== 常用方法快捷导出 ==========
function get(url) {
    return request(url, { method: 'GET' });
}

function post(url, body) {
    return request(url, { method: 'POST', body });
}

function put(url, body) {
    return request(url, { method: 'PUT', body });
}

function del(url) {
    return request(url, { method: 'DELETE' });
}