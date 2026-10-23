// Persistent storage is not yet connected.
// Vercel's deployed function filesystem is read-only, so this module must not
// create or mutate local JSON files. Replace these guards with the verified
// Supabase data adapter once the existing table schema is confirmed.

function databaseNotConfigured() {
    const error = new Error('Persistent database adapter is not configured');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
}

function readDB() {
    return databaseNotConfigured();
}

function writeDB() {
    return databaseNotConfigured();
}

function calculateWeightedRevenue(grade, studentCount) {
    let weight = 1;
    const cleanGrade = String(grade || '').trim();

    if (cleanGrade === 'M1' || cleanGrade === 'M4') weight = 3;
    else if (cleanGrade === 'M2' || cleanGrade === 'M5') weight = 2;
    else if (cleanGrade === 'M3' || cleanGrade === 'M6') weight = 1;

    const count = Number(studentCount);
    if (!Number.isFinite(count) || count < 0) {
        throw new TypeError('studentCount must be a non-negative number');
    }

    return count * 100 * weight;
}

module.exports = { readDB, writeDB, calculateWeightedRevenue };
