// netlify/functions/auth.js
const bcrypt = require('bcryptjs');
const db = require('./lib/db');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { success: false });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { success: false, message: 'Invalid JSON' }); }

  const { action, username, password, email, deviceId } = body;
  if (!action) return json(400, { success: false, message: 'Action required' });

  try {
    if (action === 'register') {
      if (!username || !password || !email)
        return json(400, { success: false, message: 'Data tidak lengkap' });
      if (username.length < 4 || username.length > 24)
        return json(400, { success: false, message: 'Username 4-24 karakter' });
      if (!/^[a-zA-Z0-9_]+$/.test(username))
        return json(400, { success: false, message: 'Username hanya huruf/angka/_' });
      if (password.length < 6)
        return json(400, { success: false, message: 'Password min. 6 karakter' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return json(400, { success: false, message: 'Email tidak valid' });

      const byDevice = await db.findByDevice(deviceId);
      if (byDevice) {
        return json(429, {
          success: false,
          message: `Perangkat ini sudah terdaftar sebagai "${byDevice.user.username}".`
        });
      }

      const newUser = {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'free',
        deviceId,
        email,
        createdAt: new Date().toISOString(),
        expiredAt: null,
        adsWatched: 0
      };

      const result = await db.addUser(newUser);
      const { passwordHash, ...safe } = newUser;
      return json(201, { success: true, user: safe, shard: result.shard });
    }

    if (action === 'login') {
      if (!username || !password || !deviceId)
        return json(400, { success: false, message: 'Data tidak lengkap' });

      const found = await db.findUser(username);
      if (!found) return json(401, { success: false, message: 'Username tidak ditemukan' });

      const user = found.user;
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) return json(401, { success: false, message: 'Password salah' });

      if (user.expiredAt && new Date(user.expiredAt) < new Date() && user.role === 'reseller') {
        user.role = 'free';
        user.expiredAt = null;
        await db.updateUser(username, () => user);
      }

      if (user.role === 'reseller' && user.deviceId && user.deviceId !== deviceId) {
        return json(403, { success: false, message: 'Akun reseller aktif di perangkat lain.' });
      }

      if (user.role === 'free' && user.deviceId !== deviceId) {
        user.deviceId = deviceId;
        await db.updateUser(username, () => user);
      }

      const { passwordHash, ...safe } = user;
      return json(200, { success: true, user: safe, shard: found.shardName });
    }

    if (action === 'reset-device') {
      await db.updateUser(username, u => ({ ...u, deviceId: null }));
      return json(200, { success: true });
    }

    if (action === 'status') {
      const found = await db.findUser(username);
      if (!found) return json(404, { success: false, message: 'User tidak ada' });
      return json(200, {
        success: true,
        role: found.user.role,
        expiredAt: found.user.expiredAt,
        shard: found.shardName
      });
    }

    if (action === 'record-ads') {
      const count = body.count || 0;
      await db.updateUser(username, u => ({ ...u, adsWatched: (u.adsWatched || 0) + count }));
      return json(200, { success: true });
    }

    if (action === 'stats') {
      const { users, manifest } = await db.getAllUsers();
      return json(200, {
        success: true,
        totalUsers: users.length,
        totalShards: manifest.shards.length,
        shards: manifest.shards.map(name => ({
          name,
          count: users.filter(u => u._shard === name).length
        })),
        currentShard: manifest.currentShard,
        tokens: db.getTokenStatus()
      });
    }

    return json(400, { success: false, message: `Action tidak dikenal: ${action}` });
  } catch (err) {
    console.error('[auth]', err);
    return json(500, { success: false, message: err.message });
  }
};
