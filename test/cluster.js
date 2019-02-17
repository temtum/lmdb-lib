'use strict';

const assert = require('assert');
const cluster = require('cluster');
const path = require('path');
const numCPUs = require('os').cpus().length;

const lmdb = require('../lmdb');

const MAX_DB_SIZE = 256 * 1024 * 1024;

if (cluster.isMaster) {

  // The master process

  const env = new lmdb.Env();

  env.open({
    path: path.resolve(__dirname, './testdata'),
    maxDbs: 10,
    mapSize: MAX_DB_SIZE,
    maxReaders: 126
  });

  const dbi = env.openDbi({
    name: 'cluster',
    create: true
  });

  const workerCount = Math.min(numCPUs * 2, 20);
  const value = Buffer.from('48656c6c6f2c20776f726c6421', 'hex');
  // This will start as many workers as there are CPUs available.
  const workers = [];

  for (let i = 0; i < workerCount; i++) {
    const worker = cluster.fork();

    workers.push(worker);
  }

  const messages = [];

  workers.forEach(function(worker) {
    worker.on('message', function(msg) {
      messages.push(msg);
      // Once every worker has replied with a response for the value
      // we can exit the test.
      if (messages.length === workerCount) {
        dbi.close();
        env.close();
        for (var i = 0; i < messages.length; i ++) {
          assert(messages[i] === value.toString('hex'));
        }
        process.exit(0);
      }
    });
  });

  const txn = env.beginTxn();

  for (let i = 0; i < workers.length; i++) {
    txn.putBinary(dbi, 'key' + i, value);
  }

  txn.commit();

  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];

    worker.send({key: 'key' + i});
  }

} else {
  // The worker process
  const env = new lmdb.Env();

  env.open({
    path: path.resolve(__dirname, './testdata'),
    maxDbs: 10,
    mapSize: MAX_DB_SIZE,
    maxReaders: 126,
    readOnly: true
  });

  const dbi = env.openDbi({
    name: 'cluster'
  });

  process.on('message', function(msg) {
    if (msg.key) {
      const txn = env.beginTxn({readOnly: true});
      const value = txn.getBinary(dbi, msg.key);

      if (value === null) {
        process.send('');
      } else {
        process.send(value.toString('hex'));
      }

      txn.abort();
    }
  });

}
