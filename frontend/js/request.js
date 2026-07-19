// frontend/js/request.js

// ========== API 基础地址 ==========
const API_BASE = 'http://localhost:3000/api';

// ========== 统一请求函数 ==========
function request(url, options = {}) {
    const token = localStorage.getItem('token');

    // 默认配置
    const config = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    };

    // 合并自定义配置（但 headers 要合并，不能覆盖）
    if (options.method) config.method = options.method;
    if (options.headers) {
        config.headers = { ...config.headers, ...options.headers };
    }
    if (options.body) {
        // 如果 body 是对象，转成 JSON 字符串
        if (typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        } else {
            config.body = options.body;
        }
    }

    // 如果有 Token，自动添加到请求头
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }

    const fullUrl = `${API_BASE}${url}`;
    console.log('📤 请求:', fullUrl, config);

    return fetch(fullUrl, config)
        .then(res => {
            console.log('📥 响应状态:', res.status);
            return res.json();
        })
        .then(data => {
            console.log('📥 响应数据:', data);
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
        })
        .catch(err => {
            console.error('❌ 请求失败:', err);
            return Promise.reject(new Error('网络错误，请确保后端服务已启动'));
        });
}

// ========== 常用方法 ==========
function get(url) {
    return request(url, { method: 'GET' });
}

function post(url, body) {
    return request(url, {
        method: 'POST',
        body: body
    });
}

function put(url, body) {
    return request(url, {
        method: 'PUT',
        body: body
    });
}

function del(url) {
    return request(url, { method: 'DELETE' });
}