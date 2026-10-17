const fs = require('fs');
const path = require('path');
const DB_FILE = path.join(__dirname, 'linc_data.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ schools: {}, users: {}, revenue: { total: 0 } }, null, 2));
}

function readDB() {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function calculateWeightedRevenue(grade, studentCount) {
    let weight = 1;
    const cleanGrade = grade.toString().trim();
    
    if (cleanGrade === 'M1' || cleanGrade === 'M4') weight = 3;
    else if (cleanGrade === 'M2' || cleanGrade === 'M5') weight = 2;
    else if (cleanGrade === 'M3' || cleanGrade === 'M6') weight = 1;

    const baseRate = 100; 
    return studentCount * baseRate * weight;
}

module.exports = { readDB, writeDB, calculateWeightedRevenue };