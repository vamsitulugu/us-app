const path = require('path');
const { fake, db, storage, missingTables, rpcCalls } = require('./fake-supabase');
const REPO = path.resolve(__dirname, '..', '..');
const key = require.resolve(path.join(REPO, 'middleware/supabase.js'));
require.cache[key] = { id: key, filename: key, loaded: true, exports: fake };
const express = require('express');
function makeApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/music', require(path.join(REPO, 'routes/music.js')));
  app.use('/api/recordings', require(path.join(REPO, 'routes/recordings.js')));
  app.use('/api/media', require(path.join(REPO, 'routes/media.js')));
  return app;
}
module.exports = { makeApp, db, storage, missingTables, rpcCalls };
