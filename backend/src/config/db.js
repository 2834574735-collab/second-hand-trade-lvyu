const mysql = require('mysql2');

const pool = mysql.createPool(process.env.MYSQL_URL);

const promisePool = pool.promise();
module.exports = promisePool;