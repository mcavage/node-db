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
var db = new Db({location: location});
var fixtures = [];

var setup = function(callback) {
  db.openSync();
  db.ensureUniqueIndexSync({attr: 'email'});
  db.ensureUniqueIndexSync({attr: 'first_name'});
  db.ensureIndexSync({attr: 'company'});
  db.ensureIndexSync({attr: 'city'});

  var finished = 0;
  var objects = JSON.parse(fs.readFileSync('test/fixtures.js',
					   encoding='utf8'));

  var addCallback = function(err) {
    assert.ok(!err, "insert failed");
    if(++finished >= objects.length) {
      callback();
    }
  };

  for (var i = 0; i < objects.length; i++) {
    fixtures.push(objects[i]);
    db.add(objects[i], addCallback);
  }
};

var teardown = function(callback) {
  db.closeSync();
  exec("rm -fr " + location, function(err, stdout, stderr) {
    callback();
  });
};

var findWithUniqueIndexKey = function(callback) {
  var EMAIL = 'jack.elk@coyote.com';
  db.find({email: EMAIL}, function(err, objects) {
    assert.ok(!err, 'find failed: ' + (err ? err.stack : null));
    assert.ok(objects, 'find didn\'t return an object');
    assert.equal('object', (typeof objects), "Wrong type returned");
    assert.equal(1, objects.length, 'Wrong number of objects returned' +
		objects.length);

    for(var i = 0; i < fixtures.length; i++) {
      if (fixtures[i].email === EMAIL) {
	assert.deepEqual(fixtures[i],  objects[0], 'Wrong object');
	break;
      }
    }

    callback();
  });
};

var findNonUniques = function(callback) {
  var CITY = 'Seattle';
  db.find({city: CITY}, function(err, objects) {
    assert.ok(!err, 'find failed: ' + (err ? err.stack : null));
    assert.ok(objects, 'find didn\'t return an object');
    assert.equal('object', (typeof objects), "Wrong type returned");
    assert.equal(2, objects.length, 'Wrong number of objects returned');

    for (var i = 0; i < fixtures.length; i++) {
      if (fixtures[i].city !== CITY) continue;

      for (var j = 0; j < objects.length; j++) {
	if (fixtures[i]._id !== objects[j]._id) continue;
	assert.deepEqual(fixtures[i], objects[j], "Wrong object!");
      }
    }

    callback();
  });
};

var list = function(callback) {
  var next;

  var _list = function(limit, start) {
    db.list({limit: limit, start: start}, function(err, objects) {
      for (var i = 0; i < fixtures.length; i++) {
	for (var j = 0; j < objects.length; j++) {
	  if (fixtures[i]._id !== objects[j]._id) continue;
	  assert.deepEqual(fixtures[i], objects[j], "Wrong object!");
	}
      }

      if (objects.length == 0 || objects.length < limit) return callback();
      return _list(limit, objects[objects.length -1 ]._id);
    });
  };

  _list(2);
};

process.on('uncaughtException', function(err) {
  console.log(err.message + ':\n' + err.stack);
  teardown(function() {});
});

setup(function() {
  findWithUniqueIndexKey(function() {
    console.log('findWithUniqueIndexKey: PASSED');
    findNonUniques(function() {
      console.log('findNonUniques: PASSED');
      list(function() {
	console.log('list: PASSED');
	teardown(function() {
	  console.log('test_find: PASSED');
	});
      });
    });
  });
});

