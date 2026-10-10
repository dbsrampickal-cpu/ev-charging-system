const oracledb = require('oracledb');
const path = require('path');

require('dotenv').config({
    path: path.join(__dirname, '../.env')
});

console.log("DB USER:", process.env.DB_USER);
console.log("DB PASSWORD EXISTS:", !!process.env.DB_PASSWORD);
console.log("DB CONNECTION EXISTS:", !!process.env.DB_CONNECTION_STRING);

async function getConnection() {
    return await oracledb.getConnection({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionString: process.env.DB_CONNECTION_STRING
    });
}

module.exports = { getConnection };