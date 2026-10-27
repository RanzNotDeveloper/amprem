// netlify/functions/lib/db.js
const GITHUB_TOKENS = [
  process.env.GITHUB_TOKEN,
  process.env.GITHUB_TOKEN_2,
  process.env.GITHUB_TOKEN_3,
].filter(Boolean);

if (GITHUB_TOKENS.length === 0) {
  throw new Error('Minimal GITHUB_TOKEN harus diisi!');
}

const GH_REPO   = process.env.GITHUB_REPO;
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DATA_DIR  = process.env.GITHUB_DATA_DIR || 'data';
const MAX_USERS = parseInt(process.env.MAX_USERS_PER_SHARD || '100');
const MANIFEST  = `${DATA_DIR}/shards-manifest.json`;
const API_BASE  = `https://api.github.com/repos/${GH_REPO}/contents`;

let activeTokenIdx = 0;

function getHeaders(tokenIdx = activeTokenIdx) {
  return {
    Authorization: `token ${GITHUB_TOKENS[tokenIdx]}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'amprem-db'
  };
}

function isRateLimit(status, body) {
  if (status === 429) return true;
  if (status === 403 && body) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body);
    return msg.includes('rate limit');
  }
  return false;
}

function rotateToken() {
  if (GITHUB_TOKENS.length <= 1) return false;
  activeTokenIdx = (activeTokenIdx + 1) % GITHUB_TOKENS.length;
  return true;
}

async function ghFetch(url, options = {}, attempt = 0) {
  if (attempt >= GITHUB_TOKENS.length + 1) {
    throw new Error('Semua token GitHub kena rate limit.');
  }
  const res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers || {}) }
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  if (isRateLimit(res.status, body)) {
    if (rotateToken()) return ghFetch(url, options, attempt + 1);
    throw new Error('Rate limit GitHub di semua token.');
  }
  return { res, body };
}

async function readFile(path) {
  const url = `${API_BASE}/${path}?ref=${GH_BRANCH}`;
  const { res, body } = await ghFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Baca ${path} gagal: ${res.status}`);
  return {
    data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')),
    sha: body.sha
  };
}

async function writeFile(path, data, sha = null, message = 'update') {
  const url = `${API_BASE}/${path}`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = { message, content, branch: GH_BRANCH };
  if (sha) body.sha = sha;

  const { res, body: resBody } = await ghFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Tulis ${path} gagal: ${res.status}`);
  return resBody;
}

async function readManifest() {
  const result = await readFile(MANIFEST);
  if (!result) {
    const defaultManifest = {
      shards: ['users.json'],
      currentShard: 'users.json',
      maxUsersPerShard: MAX_USERS,
      lastRotation: new Date().toISOString()
    };
    await writeFile(MANIFEST, defaultManifest, null, 'init manifest');
    return defaultManifest;
  }
  return result.data;
}

async function findUser(username) {
  const manifest = await readManifest();
  for (const shardName of manifest.shards) {
    const path = `${DATA_DIR}/${shardName}`;
    const result = await readFile(path);
    if (!result) continue;
    const idx = result.data.users.findIndex(
      u => u.username.toLowerCase() === username.toLowerCase()
    );
    if (idx >= 0) {
      return {
        user: result.data.users[idx],
        shardName,
        shardPath: path,
        shardData: result.data,
        shardSha: result.sha,
        index: idx
      };
    }
  }
  return null;
}

async function findByEmail(email) {
  const manifest = await readManifest();
  for (const shardName of manifest.shards) {
    const result = await readFile(`${DATA_DIR}/${shardName}`);
    if (!result) continue;
    const found = result.data.users.find(
      u => u.email && u.email.toLowerCase() === email.toLowerCase()
    );
    if (found) return { user: found, shardName };
  }
  return null;
}

async function findByDevice(deviceId) {
  const manifest = await readManifest();
  for (const shardName of manifest.shards) {
    const result = await readFile(`${DATA_DIR}/${shardName}`);
    if (!result) continue;
    const found = result.data.users.find(u => u.deviceId === deviceId);
    if (found) return { user: found, shardName };
  }
  return null;
}

async function addUser(newUser) {
  if (await findUser(newUser.username)) throw new Error('Username sudah dipakai');
  if (newUser.email && await findByEmail(newUser.email)) 
    throw new Error('Email sudah terdaftar');

  const manifest = await readManifest();
  let targetShard = manifest.currentShard;
  let targetPath = `${DATA_DIR}/${targetShard}`;
  let targetResult = await readFile(targetPath);
  if (!targetResult) targetResult = { data: { users: [] }, sha: null };

  if (targetResult.data.users.length >= MAX_USERS) {
    const newShardName = generateNextShardName(manifest.shards);
    targetShard = newShardName;
    targetPath = `${DATA_DIR}/${targetShard}`;
    targetResult = { data: { users: [] }, sha: null };

    manifest.shards.push(newShardName);
    manifest.currentShard = newShardName;
    manifest.lastRotation = new Date().toISOString();

    const manifestResult = await readFile(MANIFEST);
    await writeFile(MANIFEST, manifest, manifestResult?.sha, `rotate: ${newShardName}`);
  }

  targetResult.data.users.push(newUser);
  await writeFile(targetPath, targetResult.data, targetResult.sha, 
    `register: ${newUser.username} (${targetShard})`);

  return { shard: targetShard, user: newUser };
}

async function updateUser(username, updater) {
  const found = await findUser(username);
  if (!found) throw new Error('User tidak ditemukan');
  const updated = updater({ ...found.user });
  found.shardData.users[found.index] = updated;
  await writeFile(found.shardPath, found.shardData, found.shardSha, `update: ${username}`);
  return updated;
}

async function deleteUser(username) {
  const found = await findUser(username);
  if (!found) throw new Error('User tidak ditemukan');
  found.shardData.users.splice(found.index, 1);
  await writeFile(found.shardPath, found.shardData, found.shardSha, `delete: ${username}`);
  return true;
}

async function getAllUsers() {
  const manifest = await readManifest();
  const all = [];
  for (const shardName of manifest.shards) {
    const result = await readFile(`${DATA_DIR}/${shardName}`);
    if (!result) continue;
    result.data.users.forEach(u => all.push({ ...u, _shard: shardName }));
  }
  return { users: all, manifest };
}

function generateNextShardName(existing) {
  let n = 2;
  while (existing.includes(`users${n}.json`)) n++;
  return `users${n}.json`;
}

function getTokenStatus() {
  return {
    totalTokens: GITHUB_TOKENS.length,
    activeTokenIdx,
    activeTokenPreview: GITHUB_TOKENS[activeTokenIdx]?.slice(0, 12) + '...'
  };
}

module.exports = {
  readFile, writeFile, readManifest,
  findUser, findByEmail, findByDevice,
  addUser, updateUser, deleteUser,
  getAllUsers, getTokenStatus
};
