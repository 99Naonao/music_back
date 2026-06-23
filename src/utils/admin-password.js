const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password) {
    const plain = password != null ? String(password) : '';
    if (!plain) {
        throw new Error('密码不能为空');
    }
    const salt = randomBytes(SALT_LEN);
    const hash = scryptSync(plain, salt, KEY_LEN);
    return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
    const plain = password != null ? String(password) : '';
    const stored = storedHash != null ? String(storedHash) : '';
    if (!plain || !stored) return false;

    const parts = stored.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    try {
        const salt = Buffer.from(parts[1], 'hex');
        const expected = Buffer.from(parts[2], 'hex');
        const actual = scryptSync(plain, salt, KEY_LEN);
        if (expected.length !== actual.length) return false;
        return timingSafeEqual(expected, actual);
    } catch (e) {
        return false;
    }
}

module.exports = {
    hashPassword,
    verifyPassword
};
