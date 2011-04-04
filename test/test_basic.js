// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var assert = require('assert');
var exec  = require('child_process').exec;
var fs = require('fs');
var util = require('util');
var uuid = require('node-uuid');
var Db = require('db');

// Initialization
var location = '/tmp/' + uuid();
fs.mkdirSync(location, 0750);
var db = new Db({location: location, encrypt: 's3cr3t'});

var setup = function(callback) {
  db.openSync();
  db.ensureIndexSync({attr: 'testAlternate'});
  callback();
};

var teardown = function(callback) {
  db.closeSync();
  exec("rm -fr " + location, function(err, stdout, stderr) {
    callback();
  });
};

var add = function(callback) {
  var data = {};

  db.insert(data, function(err) {
    assert.ok(!err, 'put failed: ' + (err ? err.message : null));
    assert.ok(data._id, 'put didn\'t tack on an _id');
    callback();
  });
};

var get = function(callback) {
  var data = {_test: uuid()};

  db.insert(data, function(err) {
    assert.ok(!err, 'put failed: ' + (err ? err.message : null));
    db.get(data._id, function(err, obj) {
      assert.ok(!err, 'get failed: ' + (err ? err.message : null));
      assert.ok(obj, 'get didn\'t return an object');
      assert.deepEqual(data, obj, 'get didn\'t return our object');
      callback();
    });
  });
};

var del = function(callback) {
  var data = {_foo: uuid(), _bar: uuid(), somethingElse: uuid()};

  db.insert(data, function(err) {
    assert.ok(!err, 'put failed: ' + (err ? err.message : null));
    db.del(data._id, function(err) {
      assert.ok(!err, 'del failed: ' + (err ? err.message : null));
      db.get(data._id, function(err, obj) {
	assert.ok(err, 'get didn\'t fail after del');
	assert.equal(err.name, 'DbError', 'Error.name mismatch');
	assert.equal(err.code, 'NotFound', 'Error.code mismatch');
	callback();
      });
    });
  });
};

var update = function(callback) {
  var data = {foo: uuid(), bar: uuid()};

  db.insert(data, function(err) {
    assert.ok(!err, 'put failed: ' + (err ? err.message : null));
    data.blah = uuid();
    db.update(data, function(err) {
      assert.ok(!err, 'update failed: ' + (err ? err.message : null));
      data._version = 7;
      db.update(data, function(err) {
	assert.ok(err, 'update didn\'t fail');
	assert.equal(err.name, 'DbError', 'Error.name mismatch');
	assert.equal(err.code, 'ConsistencyError', 'Error.code mismatch');
	callback();
      });
    });
  });
};

process.on('uncaughtException', function(err) {
  console.log(err.message + ':\n' + err.stack);
  teardown(function() {});
});

setup(function() {
  add(function() {
    console.log('add: PASSED');
    get(function() {
      console.log('get: PASSED');
      del(function() {
	console.log('del: PASSED');
	update(function() {
	  console.log('update: PASSED');
	  teardown(function() {
	    console.log('test_basic: PASSED');
	  });
	});
      });
    });
  });
});

