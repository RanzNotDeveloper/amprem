// netlify/functions/admin.js
const bcrypt = require('bcryptjs');
const db = require('./lib/db');

const ADMIN_KEY = process.env.ADMIN_KEY;
const json = (s, b) => ({ 
  statusCode: s, 
  headers: { 'Content-Type': 'application/json' }, 
  body: JSON.stringify(b) 
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { success: false });

  let body;
  try { body = JSON.parse(event.body || '{}'); } 
  catch { return json(400, { success: false }); }

  if (!ADMIN_KEY || body.adminKey !== ADMIN_KEY) 
    return json(403, { success: false, message: 'Forbidden' });

  const { action, username, durationDays, password, role, email } = body;

  try {
    if (action === 'reset-device') {
      await db.updateUser(username, u => ({ ...u, deviceId: null }));
      return json(200, { success: true, message: `Device ${username} direset` });
    }

    if (action === 'upgrade-reseller') {
      const expiredAt = new Date(Date.now() + (durationDays || 30) * 864e5).toISOString();
      await db.updateUser(username, u => ({ ...u, role: 'reseller', expiredAt }));
      return json(200, { success: true, expiredAt });
    }

    if (action === 'downgrade') {
      await db.updateUser(username, u => ({ ...u, role: 'free', expiredAt: null }));
      return json(200, { success: true });
    }

    if (action === 'create-user') {
      const newUser = {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        role: role || 'free',
        deviceId: null,
        email: email || null,
        createdAt: new Date().toISOString(),
        expiredAt: role === 'reseller'
          ? new Date(Date.now() + (durationDays || 30) * 864e5).toISOString()
          : null,
        adsWatched: 0
      };
      const result = await db.addUser(newUser);
      return json(201, { success: true, shard: result.shard });
    }

    if (action === 'delete-user') {
      await db.deleteUser(username);
      return json(200, { success: true });
    }

    if (action === 'list-users') {
      const { users, manifest } = await db.getAllUsers();
      return json(200, {
        success: true,
        total: users.length,
        shards: manifest.shards,
        currentShard: manifest.currentShard,
        tokens: db.getTokenStatus(),
        users: users.map(u => ({
          username: u.username, role: u.role,
          email: u.email, expiredAt: u.expiredAt,
          deviceId: u.deviceId, shard: u._shard
        }))
      });
    }

    return json(400, { success: false, message: 'Action tidak dikenal' });
  } catch (err) {
    console.error('[admin]', err);
    return json(500, { success: false, message: err.message });
  }
};
