// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var fs = require('fs');
var exec  = require('child_process').exec;
var http = require('http');
var path = require('path');
var url = require('url');

var Db = require('db');

var logFile = '/tmp/node-db-sample.log'

var db = new Db({
  location: process.argv[2],
  errorFile: logFile
});

var clean = false;
var shutdown = function() {
  if (clean) return;

  try {
    console.log('node-db error log contents:');
    console.log(fs.readFileSync(logFile, encoding='utf8'));
  } catch(e) {
    console.log('Unable to read ' + logFile + ': ' + e);
  }
  exec("rm -f " + logFile, function(err, stdout, stderr) {
    clean = true;
    process.exit(0);
  });
}


var get = function(request, response) {
  var parsed = url.parse(request.url, true);
  var id = parsed.pathname.substr(1);

  var respond = function(err, objects, isArray) {
    if (err) {
      if (err.code === 'NotFound') {
	response.writeHead(404, err.code);
      } else if (err.code === 'NoIndex') {
	response.writeHead(409, err.code);
      } else {
	response.writeHead(500, err.code);
      }
    } else {
      if ((isArray && objects.length > 0) ||
	  (!isArray && objects)) {
	response.writeHead(200, {'content-type': 'application/json'});
	response.write(JSON.stringify(objects));
      } else {
	response.writeHead(404, attr + '=' + filter[k]);
      }
    }
    return response.end();
  };


  if (id.length > 0) {
    db.get(id, function(err, object) {
      respond(err, object, false);
    });
  } else {
    var opts = {};
    var filter = {};
    var attr;
    for (var k in parsed.query) {
      if (k === 'limit') {
	opts.limit = parseInt(parsed.query[k]);
      } else {
	attr = k;
	filter[k] = parsed.query[k];
      }
    }

    db.find(filter, opts, function(err, objects) {
      respond(err, objects, true);
    });
  }
};

var create = function(request, response) {
  var parsed = url.parse(request.url, true);
  var obj = {};
  for (var k in parsed.query) {
    obj[k] = parsed.query[k];
  }

  db.add(obj, function(err) {
    if (err) {
      if (err.code === 'InvalidArgument') {
	response.writeHead(409, err.code);
      } else {
	response.writeHead(500, err.code);
      }
    } else {
      response.writeHead(204);
    }
    response.end();
  });
};

var update = function(request, response) {
  var _update = function(obj) {
    db.update(obj, function(err) {
      if (err) {
	if (err.code === 'ConsistencyError') {
	  response.writeHead(409, 'Version Mismatch');
	} else {
	  response.writeHead(500, err.code);
	}
      } else {
	response.writeHead(204);
      }
      response.end();
    });
  };

  var body = '';
  request.setEncoding(encoding='utf8');
  request.on('data', function(chunk) {
    body = body + chunk;
  });
  request.on('end', function() {
    var obj;
    try {
      _update(JSON.parse(body));
    } catch(e) {
      response.writeHead(409, 'Invalid JSON');
      response.end();
    }
  });
};

var remove = function(request, response) {
  var parsed = url.parse(request.url, true);
  var id = parsed.pathname.substr(1);
  db.del(id, function(err) {
    if (err) {
      if (err.code === 'NotFound') {
	response.writeHead(404, id);
      } else {
	response.writeHead(500, err.code);
      }
    } else {
      response.writeHead(204);
    }
    response.end();
  });
};

var server = http.createServer(function(request, response) {
  if (request.method === 'GET') {
    get(request, response);
  } else if (request.method === 'POST') {
    create(request, response);
  } else if (request.method == 'PUT') {
    update(request, response);
  } else if (request.method === 'DELETE') {
    remove(request, response);
  } else {
    response.writeHead(501, request.method + ' not supported.');
  }
});

db.openSync();

process.on('exit', shutdown);
process.on('SIGINT', shutdown);

server.listen(3000);
