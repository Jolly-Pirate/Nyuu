#!/usr/bin/env node

"use strict";
process.title = 'Nyuu';

var fs;
var util = require('../lib/util');
var error = function(msg) {
	console.error(msg);
	console.error('Enter `nyuu --help` or `nyuu --help-full` for usage information');
	process.exit(1);
};
var processes;
var processStart = function() {
	if(!processes) processes = new (require('../lib/procman'))();
	return processes.start.apply(processes, arguments);
};

var servOptMap = {
	host: {
		type: 'string',
		alias: 'h'
	},
	port: {
		type: 'int',
		alias: 'P',
		keyMap: 'connect/port'
	},
	'bind-host': {
		type: 'string',
		keyMap: 'connect/localAddress'
	},
	'tcp-keep-alive': {
		type: 'time',
		keyMap: 'tcpKeepAlive'
	},
	ipv6: {
		type: 'bool',
		keyMap: 'connect/family',
		fn: function(v) {
			return v ? 6 : undefined;
		},
		alias: '6'
	},
	ssl: {
		type: 'bool',
		keyMap: 'secure',
		alias: 'S'
	},
	'ignore-cert': {
		type: 'bool',
		keyMap: 'connect/rejectUnauthorized',
		fn: function(v) {
			return !v;
		}
	},
	'sni-host': {
		type: 'string',
		keyMap: 'connect/servername'
	},
	'ssl-ciphers': {
		type: 'string',
		keyMap: 'connect/ciphers'
	},
	'ssl-method': {
		type: 'string',
		keyMap: 'connect/secureProtocol'
	},
	user: {
		type: 'string',
		alias: 'u',
		keyMap: 'user'
	},
	password: {
		type: 'string',
		alias: 'p',
		keyMap: 'password'
	},
	timeout: {
		type: 'time',
		keyMap: 'timeout'
	},
	'connect-timeout': {
		type: 'time',
		keyMap: 'connTimeout'
	},
	'reconnect-delay': {
		type: 'time',
		keyMap: 'reconnectDelay'
	},
	'connect-retries': {
		type: 'int',
		keyMap: 'connectRetries'
	},
	'request-retries': {
		type: 'int',
		keyMap: 'requestRetries'
	},
	'post-retries': {
		type: 'int',
		postOnly: true,
		keyMap: 'postRetries'
	},
	'on-post-timeout': {
		type: 'string',
		postOnly: true,
		keyMap: 'onPostTimeout',
		fn: function(v) {
			return v.split(',').map(function(s) {
				var v = s.trim().toLowerCase();
				if(v != 'retry' && v != 'ignore' && !v.match(/^strip-hdr=./))
					error('Unknown value for `--on-post-timeout`: ' + s);
				return v;
			});
		}
	},
	'keep-alive': {
		type: 'bool',
		keyMap: 'keepAlive'
	},
};

var optMap = {
	connections: {
		type: 'int',
		alias: 'n',
		map: 'server/connections'
	},
	'check-connections': {
		type: 'int',
		map: 'check/server/connections',
		alias: 'k'
	},
	/*'check-reuse-conn': {
		type: 'bool',
		map: 'check/ulConnReuse'
	},*/
	'check-delay': {
		type: 'time',
		map: 'check/delay'
	},
	'check-retry-delay': {
		type: 'time',
		map: 'check/recheckDelay'
	},
	'check-tries': {
		type: 'int',
		map: 'check/tries'
	},
	'check-group': {
		type: 'string',
		map: 'check/group'
	},
	'check-post-tries': {
		type: 'int',
		map: 'check/postRetries'
	},
	'article-size': {
		type: 'size',
		alias: 'a',
		map: 'articleSize'
	},
	'article-line-size': {
		type: 'int',
		map: 'bytesPerLine',
		fn: function(v) {
			if(v < 1) error('Invalid value for `article-line-size`');
			return v;
		}
	},
	comment: {
		type: 'string',
		alias: 't',
		map: 'comment'
	},
	comment2: {
		type: 'string',
		map: 'comment2'
	},
	date: {
		type: 'string',
		map: 'postDate',
		fn: function(v) {
			if((typeof v == 'string') && v.toLowerCase() == 'now')
				return Date.now();
			return v;
		}
	},
	'keep-message-id': {
		type: 'bool',
		map: 'keepMessageId'
	},
	'group-files': {
		type: 'bool',
		alias: 'F',
		map: 'groupFiles'
	},
	header: {
		type: 'map',
		alias: 'H'
	},
	subject: {
		type: 'string',
		alias: 's',
		map: 'postHeaders/Subject',
		fn: function(v) {
			return function(filenum, filenumtotal, filename, filesize, part, parts, size) {
				return v.replace(/\{(filenum|files|filename|filesize|parts?|size)\}/ig, function(p) {
					switch(p[1].toLowerCase()) {
						case 'filenum': return filenum;
						case 'files': return filenumtotal;
						case 'filename': return filename;
						case 'filesize': return filesize;
						case 'part': return part;
						case 'parts': return parts;
						case 'size': return size;
					}
				});
			};
		}
	},
	from: {
		type: 'string',
		alias: 'f',
		map: 'postHeaders/From'
	},
	groups: {
		type: 'string',
		alias: 'g',
		map: 'postHeaders/Newsgroups'
	},
	out: {
		type: 'string',
		alias: 'o',
		map: 'nzb/writeTo',
		fn: function(v) {
			if(v === '-')
				return process.stdout;
			else if(v.match(/^proc:\/\//i)) {
				return function(cmd) {
					return processStart(cmd, {stdio: ['pipe','ignore','ignore']}).stdin;
					// if process exits early, the write stream should break and throw an error
				}.bind(null, v.substr(7));
			}
			return v;
		}
	},
	minify: {
		type: 'bool',
		map: 'nzb/minify'
	},
	'nzb-compress': {
		type: 'string',
		map: 'nzb/compression',
		fn: function(v) {
			if(['gzip','zlib','deflate','xz'].indexOf(v) < 0)
				error('Invalid value supplied for `--nzb-compress`');
			return v;
		}
	},
	'nzb-compress-level': {
		type: 'int',
		map: 'nzb/compressOpts/level'
	},
	'nzb-encoding': {
		type: 'string',
		map: 'nzb/writeOpts/encoding'
	},
	overwrite: {
		type: 'bool',
		alias: 'O',
		map: 'nzb/writeOpts/flags',
		fn: function(v) {
			return v ? 'w' : 'wx';
		}
	},
	meta: {
		type: 'map',
		alias: 'M',
		fn: function(v, o) {
			for(var k in v)
				o.nzb.metaData[k] = v[k];
		}
	},
	subdirs: {
		type: 'string',
		alias: 'r',
		map: 'subdirs',
		fn: function(v) {
			if(['skip','keep'].indexOf(v) < 0)
				error('Invalid option supplied for `--subdirs`');
			return v;
		}
	},
	'disk-req-size': {
		type: 'size',
		map: 'diskReqSize'
	},
	'disk-buf-size': {
		type: 'int',
		map: 'diskBufferSize'
	},
	'post-queue-size': {
		type: 'int',
		map: 'articleQueueBuffer'
	},
	'check-queue-size': {
		type: 'int',
		map: 'check/queueBuffer'
	},
	'use-post-pool': {
		type: 'bool',
		map: 'useBufferPool'
	},
	'preload-modules': {
		type: 'bool'
	},
	'use-lazy-connect': {
		type: 'bool',
		map: 'useLazyConnect'
	},
	'skip-errors': {
		type: 'string',
		alias: 'e',
		map: 'skipErrors',
		fn: function(v) {
			if(v.toLowerCase() == 'all')
				return true;
			return v.split(',').map(function(s) {
				return s.trim().toLowerCase();
			});
		}
	},
	'post-error-limit': {
		type: 'int',
		map: 'maxPostErrors'
	},
	'dump-failed-posts': {
		type: 'string',
		map: 'dumpPostLoc'
	},
	'input-raw-posts': {
		type: 'bool'
	},
	'delete-raw-posts': {
		type: 'bool',
		map: 'deleteRawPosts'
	},
	'copy-input': {
		type: 'string'
	},
	'copy-include': {
		type: 'string'
	},
	'copy-exclude': {
		type: 'string'
	},
	'copy-queue-size': {
		type: 'int',
		map: 'copyQueueBuffer'
	},
	
	help: {
		type: 'bool',
		alias: '?'
	},
	'help-full': {
		type: 'bool'
	},
	version: {
		type: 'bool'
	},
	'log-level': {
		type: 'int',
		alias: 'l'
	},
	'log-time': {
		type: 'bool',
		alias: 'T'
	},
	verbose: {
		type: 'bool',
		alias: 'v'
	},
	quiet: {
		type: 'bool',
		alias: 'q'
	},
	progress: {
		type: 'array'
	},
	config: {
		type: 'string',
		alias: 'C'
	}
};

for(var k in servOptMap) {
	var o = util.clone(servOptMap[k]);
	if('keyMap' in o)
		o.map = 'server/' + o.keyMap;
	optMap[k] = o;
	if(!o.postOnly) {
		var o2 = util.clone(servOptMap[k]);
		delete o2.alias;
		if('keyMap' in o)
			o.map = 'check/server/' + o.keyMap;
		optMap['check-' + k] = o2;
	}
}


// build minimist's option map
var mOpts = {string: [], boolean: [], alias: {}, default: {}};
for(var k in optMap) {
	var o = optMap[k];
	if(o.type == 'bool') {
		mOpts.boolean.push(k);
		mOpts.default[k] = null; // prevent minimist from setting this as false
	} else
		mOpts.string.push(k);
	
	if(o.alias) {
		mOpts.alias[o.alias] = k;
	}
}


var argv = require('minimist')(process.argv.slice(2), mOpts);


if(argv['help-full']) {
	console.error(require('fs').readFileSync(__dirname + '/../help.txt').toString().replace(/^Nyuu(\r?\n)/, 'Nyuu v' + require('../package.json').version + '$1'));
	process.exit(0);
}
if(argv.help) {
	console.error(require('fs').readFileSync(__dirname + '/../help-short.txt').toString().replace(/^Nyuu(\r?\n)/, 'Nyuu v' + require('../package.json').version + '$1'));
	process.exit(0);
}
if(argv.version) {
	console.error(require('../package.json').version);
	process.exit(0);
}

var parseSize = function(s) {
	if(typeof s == 'number' || (s|0) || s === '0') return Math.floor(s);
	var parts;
	if(parts = s.match(/^([0-9.]+)([kKmMgGtTpPeE])$/)) {
		var num = +(parts[1]);
		switch(parts[2].toUpperCase()) {
			case 'E': num *= 1024;
			case 'P': num *= 1024;
			case 'T': num *= 1024;
			case 'G': num *= 1024;
			case 'M': num *= 1024;
			case 'K': num *= 1024;
		}
		if(isNaN(num)) return false;
		return Math.floor(num);
	}
	return false;
};
var parseTime = function(s) {
	if(typeof s == 'number' || (s|0) || s === '0') return Math.floor(s*1000);
	var parts;
	if(parts = s.match(/^([0-9.]+)([mM]?[sS]|[mMhHdDwW])$/)) {
		var num = +(parts[1]);
		switch(parts[2].toLowerCase()) {
			case 'w': num *= 7;
			case 'd': num *= 24;
			case 'h': num *= 60;
			case 'm': num *= 60;
			case 's': num *= 1000;
		}
		if(isNaN(num)) return false;
		return Math.floor(num);
	}
	return false;
};

var ulOpts = require('../config.js');
if(argv.config) {
	// TODO: allow proc:// or json:// ?
	var cOpts = require(require('fs').realpathSync(argv.config));
	util.deepMerge(ulOpts, cOpts);
}

for(var k in argv) {
	if(k == '_') continue;
	var v = argv[k];
	
	if(k in mOpts.alias) continue; // ignore minimist's annoying behaviour of setting aliased options
	if(!(k in optMap))
		error('Unknown option `' + k + '`');
	
	var o = optMap[k];
	if(o.type == 'bool' && v === null) continue; // hack to get around minimist forcing unset values to be false
	if(o.type == 'int') {
		v = v|0;
		if(v < 0) error('Invalid number specified for `' + k + '`');
	}
	if(o.type == '-int')
		v = v|0;
	if(o.type == 'size') {
		v = parseSize(v);
		if(!v) error('Invalid size specified for `' + k + '`');
	}
	if(o.type == 'time') {
		v = parseTime(v);
		if(v === false) error('Invalid time specified for `' + k + '`');
	}
	
	// fix arrays/maps
	var isArray = Array.isArray(v);
	if(o.type == 'array' || o.type == 'map') {
		if(!isArray) argv[k] = [v];
		// create map
		if(o.type == 'map') {
			v = {};
			argv[k].forEach(function(h) {
				var m;
				if(m = h.match(/^(.+?)[=:](.*)$/)) {
					v[m[1].trim()] = m[2].trim();
				} else {
					error('Invalid format for `' + k + '`');
				}
			});
			argv[k] = v;
		}
	} else if(isArray)
		error('Multiple values supplied for `' + k + '`!');
	
	if(o.map) {
		var path = o.map.split('/');
		var config = ulOpts;
		for(var i=0; i<path.length-1; i++) {
			if(!(path[i] in config))
				config[path[i]] = {};
			config = config[path[i]];
		}
		config[path.slice(-1)] = o.fn ? o.fn(v, ulOpts) : v;
	} else if(o.fn)
		o.fn(v, ulOpts);
}

if(argv['dump-failed-posts']) {
	try {
		if(require('fs').statSync(argv['dump-failed-posts']).isDirectory()) {
			// if supplied a folder, append a directory separator if not supplied
			var sep = require('path').sep;
			if(ulOpts.dumpPostLoc.substr(-1) != sep)
				ulOpts.dumpPostLoc += sep;
		}
	} catch(x) {}
}

var hostFn = function(o, v) {
	if(v.match(/^unix:/i))
		o.path = v.substr(5);
	else
		o.host = v;
};
if(argv.host)
	hostFn(ulOpts.server.connect, argv.host);
if(argv['check-host'])
	hostFn(ulOpts.check.server.connect, argv['check-host']);

if(argv['copy-input']) {
	var copyIncl, copyExcl, copyTarget = argv['copy-input'];
	var reFlags = process.platform == 'win32' ? 'i' : '';
	if(argv['copy-include'])
		copyIncl = new RegExp(argv['copy-include'], reFlags);
	if(argv['copy-exclude'])
		copyExcl = new RegExp(argv['copy-exclude'], reFlags);
	
	var copyProc = copyTarget.match(/^proc:\/\//i);
	if(copyProc)
		copyTarget = copyTarget.substr(7);
	else
		fs = fs || require('fs');
	
	ulOpts.inputCopy = function(filename, size) {
		if(copyIncl && !filename.match(copyIncl)) return;
		if(copyExcl && filename.match(copyExcl)) return;
		
		var target = copyTarget.replace(/\{(filename|size)\}/ig, function(m, token) {
			return token == 'filename' ? filename : size;
		});
		if(copyProc) {
			return processStart(target, {stdio: ['pipe','ignore','ignore']}).stdin;
		} else {
			return fs.createWriteStream(target);
		}
	};
}

// map custom headers
if(argv.header) {
	// to preserve case, build case-insensitive lookup
	var headerCMap = {};
	for(var k in ulOpts.postHeaders)
		headerCMap[k.toLowerCase()] = k;
	
	for(var k in argv.header) {
		// handle casing wierdness
		var kk = headerCMap[k.toLowerCase()];
		if(!kk) {
			headerCMap[k.toLowerCase()] = kk = k;
		}
		ulOpts.postHeaders[kk] = argv.header[k];
	}
}

if(argv['preload-modules']) {
	if(ulOpts.server.secure || ulOpts.check.server.secure)
		require('tls'); // will require('net') as well
	else
		require('net');
	// we won't consider modules loaded by the UploadManager constructor (zlib/xz, nzbbuffer, bufferpool, procman) as 'too late', since it occurs before the 'start' event is fired, hence won't bother preloading these here
}

// if doing raw posts, default keepMessageId to true
if(argv['input-raw-posts'] && argv['keep-message-id'] !== false)
	ulOpts.keepMessageId = true;

// custom validation rules
if(!argv._.length)                  error('Must supply at least one input file');
// TODO: more validation

if(argv.quiet && argv.verbose)
	error('Cannot specify both `--quiet` and `--verbose`');

var verbosity = 3;
if(argv['log-level'])
	verbosity = argv['log-level'];
else if(argv.quiet)
	verbosity = 2;
else if(argv.verbose)
	verbosity = 4;

var logTimestamp;
if(argv['log-time']) {
	var tzOffset = (new Date()).getTimezoneOffset() * 60000;
	logTimestamp = function(addSpace) {
		return '[' + (new Date(Date.now() - tzOffset)).toISOString().replace('T', ' ').replace('Z', '') + ']' + addSpace;
	};
} else {
	logTimestamp = function(){ return ''; };
}

var progress = [];
var stdErrProgress = false;
if(argv.progress) {
	argv.progress.forEach(function(str) {
		var m = str.match(/^([a-z]+)(:|$)/i);
		if(!m) error('Unknown progress specification: ' + str);
		var type = m[1].toLowerCase();
		var arg = str.substr(m[0].length);
		switch(type) {
			case 'log':
				progress.push({type: 'log', interval: parseTime(arg) || 60});
			break;
			case 'stderr':
			case 'stderrx':
				progress.push({type: type});
				stdErrProgress = true;
			break;
			case 'tcp':
			case 'http':
				var o = {type: type, port: 0};
				if(m = arg.match(/^([a-z0-9\-.]*|\[[a-f0-9:]+\]):(\d*)$/i)) {
					if(m[1].length) {
						if(m[1].substr(0, 1) == '[')
							o.host = m[1].substr(1, m[1].length-2);
						else
							o.host = m[1];
					}
					o.port = m[2]|0;
				} else if((arg|0) == arg) {
					o.port = arg|0;
				} else {
					o.host = arg;
				}
				progress.push(o);
				
				if(argv['preload-modules']) {
					if(type == 'http') {
						require('http');
						require('url');
					} else {
						require('net');
					}
				}
			break;
			case 'none':
				// bypass
			break;
			default:
				error('Unknown progress specification: ' + str);
		}
	});
} else if(verbosity >= 3 && process.stderr.isTTY) {
	// default progress bar
	progress.push({type: 'stderr'});
	stdErrProgress = true;
}

var repeatChar = function(c, l) {
	if(c.repeat) return c.repeat(l);
	var buf = new Buffer(l);
	buf.fill(c);
	return buf.toString();
};
var lpad = function(s, l, c) {
	if(s.length > l) return s;
	return repeatChar((c || ' '), l-s.length) + s;
};
var rpad = function(s, l, c) {
	if(s.length > l) return s;
	return s + repeatChar((c || ' '), l-s.length);
};

var logger, errorCount = 0;
var getProcessIndicator = null;
var writeNewline = function() {
	process.stderr.write('\n');
};
var clrRow = stdErrProgress ? '\x1b[0G\x1B[0K' : '';
if(process.stderr.isTTY) {
	var writeLog = function(col, msg) {
		process.stderr.write(
			clrRow + '\x1B['+col+'m' + logTimestamp(' ') + msg.toString() + '\x1B[39m\n'
			+ (getProcessIndicator ? getProcessIndicator() : '')
		);
	};
	// assume colours are supported
	logger = {
		debug: function(msg) {
			writeLog('36', msg);
		},
		info: function(msg) {
			writeLog('32', msg);
		},
		warn: function(msg) {
			writeLog('33', msg);
		},
		error: function(msg) {
			writeLog('31', msg);
			errorCount++;
		}
	};
} else {
	var writeLog = function(type, msg) {
		process.stderr.write(
			clrRow + logTimestamp('') + type + ' ' + msg.toString() + '\n'
		);
	};
	logger = {
		debug: function(msg) {
			writeLog('[DBG] ', msg);
		},
		info: function(msg) {
			writeLog('[INFO]', msg);
		},
		warn: function(msg) {
			writeLog('[WARN]', msg);
		},
		error: function(msg) {
			writeLog('[ERR] ', msg);
			errorCount++;
		}
	};
}

var isNode010 = process.version.match(/^v0\.10\./);

if(verbosity < 4) logger.debug = function(){};
if(verbosity < 3) logger.info = function(){};
if(verbosity < 2) logger.warn = function(){};
if(verbosity < 1) {
	logger.error = function(){errorCount++;};
	// suppress output from uncaught exceptions
	process.once('uncaughtException', function(err) {
		process.exit(isNode010 ? 8 : 1);
	});
}

var displayCompleteMessage = function(err) {
	if(err)
		Nyuu.log.error(err);
	else if(errorCount)
		Nyuu.log.info('Process complete, with ' + errorCount + ' error(s)');
	else
		Nyuu.log.info('Process complete');
};

var Nyuu = argv['input-raw-posts'] ? require('../lib/postuploader') : require('../');
Nyuu.setLogger(logger);
var fuploader = Nyuu.upload(argv._.map(function(file) {
	// TODO: consider supporting deferred filesize gathering?
	var m = file.match(/^procjson:\/\/(.+?,.+?,.+)$/i);
	if(m) {
		if(m[1].substr(0, 1) != '[')
			m[1] = '[' + m[1] + ']';
		m = JSON.parse(m[1]);
		if(!Array.isArray(m) || m.length != 3)
			error('Invalid syntax for process input: ' + file);
		var ret = {
			name: m[0],
			size: m[1]|0,
			stream: function(cmd) {
				return processStart(cmd, {stdio: ['ignore','pipe','ignore']}).stdout;
			}.bind(null, m[2])
		};
		if(!ret.size)
			error('Invalid size specified for process input: ' + file);
		if(argv['preload-modules']) {
			require('../lib/procman');
			require('../lib/streamreader');
		}
		return ret;
	} else {
		if(argv['preload-modules'])
			require('../lib/filereader');
	}
	return file;
}), ulOpts, function(err) {
	var setRtnCode = function(code) {
		if(isNode010 && (!processes || !processes.running)) // .exitCode not available in node 0.10.x
			process.exit(code);
		else
			process.exitCode = code;
	};
	if(getProcessIndicator)
		process.removeListener('exit', writeNewline);
	getProcessIndicator = null;
	process.emit('finished');
	if(err) {
		displayCompleteMessage(err);
		setRtnCode(33);
	} else {
		displayCompleteMessage();
		if(errorCount)
			setRtnCode(32);
		else
			process.exitCode = 0;
	}
	(function(cb) {
		if(processes && processes.running) {
			var procWarnTO = setTimeout(function() {
				Nyuu.log.info(processes.running + ' external process(es) are still running; Nyuu will exit when these do');
			}, 1000).unref();
			processes.onEnd(function() {
				clearTimeout(procWarnTO);
				cb();
			});
		} else cb();
	})(function() {
		if(isNode010 && process.exitCode) process.exit(process.exitCode);
		setTimeout(function() {
			Nyuu.log.warn('Process did not terminate cleanly');
			process.exit();
		}, 5000).unref();
	});
});

// display some stats
var friendlySize = function(s) {
	var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
	for(var i=0; i<units.length; i++) {
		if(s < 10000) break;
		s /= 1024;
	}
	return (Math.round(s *100)/100) + ' ' + units[i];
};
var decimalPoint = ('' + 1.1).replace(/1/g, '');
var friendlyTime = function(t, compact) {
	var days = (t / 86400000) | 0;
	t %= 86400000;
	var seg = [];
	var sect = [3600000, 60000, 1000];
	if(compact && t < 3600000)
		sect.shift();
	sect.forEach(function(s) {
		seg.push(lpad('' + ((t / s) | 0), 2, '0'));
		t %= s;
	});
	var ret = (days ? days + 'd,' : '') + seg.join(':');
	if(!compact)
		ret += decimalPoint + lpad(t + '', 3, '0');
	return ret;
};
var retArg = function(_) { return _; };
fuploader.once('start', function(files, _uploader) {
	var totalSize = 0, totalPieces = 0, totalFiles = 0;
	for(var filename in files) {
		var sz = files[filename].size;
		totalSize += sz;
		totalPieces += Math.ceil(sz / ulOpts.articleSize);
		totalFiles++;
	}
	Nyuu.log.info('Uploading ' + totalPieces + ' article(s) from ' + totalFiles + ' file(s) totalling ' + friendlySize(totalSize));
	
	var uploader = _uploader.uploader;
	var startTime = Date.now();
	progress.forEach(function(prg) {
		switch(prg.type) {
			case 'log':
				var logInterval = setInterval(function() {
					Nyuu.log.info('Article posting progress: ' + uploader.articlesRead + ' read, ' + uploader.articlesPosted + ' posted, ' + uploader.articlesChecked + ' checked');
				}, prg.interval);
				logInterval.unref();
				process.on('finished', function() {
					clearInterval(logInterval);
				});
			break;
			case 'stderr':
			case 'stderrx':
				if(getProcessIndicator) break; // no need to double output =P
				var postedSamples = [[0,0]];
				getProcessIndicator = function() {
					var chkPerc = uploader.articlesChecked / totalPieces,
					    pstPerc = uploader.articlesPosted / totalPieces,
					    totPerc = Math.round((chkPerc+pstPerc)*5000)/100;
					
					// calculate speed over last 4s
					var speed = uploader.bytesPosted; // for first sample, just use current overall progress
					var completed = (uploader.articlesChecked + uploader.articlesPosted)/2;
					var advancement = completed;
					if(postedSamples.length >= 2) {
						var lastSample = postedSamples[postedSamples.length-1];
						speed = (lastSample[0] - postedSamples[0][0]) / (postedSamples.length-1);
						advancement = (lastSample[1] - postedSamples[0][1]) / (postedSamples.length-1);
					}
					
					var eta = (totalPieces - completed) / advancement;
					eta = Math.round(eta)*1000;
					if(!isNaN(eta) && isFinite(eta) && eta > 0)
						eta = friendlyTime(eta, true);
					else
						eta = '-';
					
					if(prg.type == 'stderr') {
						var LINE_WIDTH = 35;
						var barSize = Math.floor(chkPerc*LINE_WIDTH);
						var line = repeatChar('=', barSize) + repeatChar('-', Math.floor(pstPerc * LINE_WIDTH) - barSize);
						return '\x1b[0G\x1B[0K ' + lpad(totPerc.toFixed(2), 6) + '%  [' + rpad(line, LINE_WIDTH) + '] ' + friendlySize(speed) + '/s, ETA ' + eta;
					} else {
						// extended display
						var posted = '' + uploader.articlesChecked;
						if(uploader.articlesChecked != uploader.articlesPosted)
							posted += '+' + (uploader.articlesPosted - uploader.articlesChecked);
						var ret = 'Posted: ' + posted + '/' + totalPieces + ' (' + totPerc.toFixed(2) + '%) @ ' + friendlySize(speed) + '/s (raw: ' + friendlySize(uploader.currentPostSpeed()*1000) + '/s) ETA ' + eta;
						if(ret.length > 80)
							// if too long, strip the raw post speed
							ret = ret.replace(/ \(raw\: [0-9.]+ [A-Zi]+\/s\)/, ',');
						return '\x1b[0G\x1B[0K' + ret;
					}
				};
				var seInterval = setInterval(function() {
					process.stderr.write(getProcessIndicator());
					postedSamples.push([uploader.bytesPosted, (uploader.articlesChecked + uploader.articlesPosted)/2]);
					if(postedSamples.length >= 4) // maintain max 4 samples
						postedSamples.shift();
				}, 1000);
				seInterval.unref();
				process.on('finished', function() {
					clearInterval(seInterval);
				});
				// if unexpected exit, force a newline to prevent some possible terminal corruption
				process.on('exit', writeNewline);
			break;
			case 'tcp':
			case 'http':
				var writeState = function(conn) {
					var now = Date.now();
					
					// TODO: JSON output etc
					conn.write([
						'Time: ' + (new Date(now)),
						'Start time: ' + (new Date(startTime)),
						'',
						'Total articles: ' + totalPieces,
						'Articles read: ' + uploader.articlesRead,
						'Articles posted: ' + uploader.articlesPosted,
						'Articles checked: ' + uploader.articlesChecked,
						'Errors skipped: ' + errorCount + ' across ' + uploader.articleErrors + ' article(s)',
						'Raw Posting Upload Rate: ' + friendlySize(uploader.currentPostSpeed()*1000) + '/s',
						'',
						'Post connections active: ' + uploader.postConnections.filter(retArg).length,
						'Check connections active: ' + uploader.checkConnections.filter(retArg).length,
						'',
						'Post queue size: ' + uploader.queue.queue.length + (uploader.queue.hasFinished ? ' (finished)' : ''),
						'Check queue size: ' + uploader.checkQueue.queue.length + ' + ' + uploader.checkQueue.pendingAdds + ' delayed' + (uploader.checkQueue.hasFinished ? ' (finished)' : ''),
						'', ''
					].join('\r\n'));
					
					var dumpConnections = function(conns) {
						var i = 0;
						conns.forEach(function(c) {
							conn.write('Connection #' + (++i) + '\r\n');
							if(c) {
								conn.write([
									'  State: ' + c.getCurrentActivity() + (c.lastActivity ? ' for ' + ((now - c.lastActivity)/1000) + 's' : ''),
									'  Transfer: ' + friendlySize(c.bytesRecv) + ' down / ' + friendlySize(c.bytesSent) + ' up',
									'  Requests: ' + c.numRequests + ' (' + c.numPosts + ' posts)',
									'  Reconnects: ' + (c.numConnects-1),
									'  Errors: ' + c.numErrors,
									'', ''
								].join('\r\n'));
							} else {
								conn.write('  State: finished\r\n\r\n')
							}
						});
					};
					if(uploader.postConnections.length) {
						conn.write('===== Post Connections\' Status =====\r\n');
						dumpConnections(uploader.postConnections);
					}
					if(uploader.checkConnections.length) {
						conn.write('===== Check Connections\' Status =====\r\n');
						dumpConnections(uploader.checkConnections);
					}
				};
				
				var server;
				if(prg.type == 'http') {
					var url = require('url');
					server = require('http').createServer(function(req, resp) {
						var path = url.parse(req.url).pathname.replace(/\/$/, '');
						var m;
						if(m = path.match(/^\/(post|check)queue\/?$/)) {
							// dump post/check queue
							var isCheckQueue = (m[1] == 'check');
							resp.writeHead(200, {
								'Content-Type': 'text/plain'
							});
							var dumpPost = function(post) {
								resp.write([
									'Message-ID: ' + post.messageId,
									'Subject: ' + post.headers.subject,
									'Body length: ' + post.postLen,
									'Post attempts: ' + post.postTries,
									''
								].join('\r\n'));
								if(isCheckQueue)
									resp.write('Check attempts: ' + post.chkFailures + '\r\n');
							};
							uploader[isCheckQueue ? 'checkQueue' : 'queue'].queue.forEach(function(post) {
								dumpPost(post);
								resp.write('\r\n');
							});
							if(isCheckQueue && uploader.checkQueue.pendingAdds) {
								resp.write('\r\n===== Delayed checks =====\r\n');
								for(var k in uploader.checkQueue.queuePending) {
									dumpPost(uploader.checkQueue.queuePending[k].data);
									resp.write('\r\n');
								}
							}
							resp.end();
						} else if(m = path.match(/^\/(check)queue\/([^/]+)\/?$/)) {
							// search queue for target post
							var q = uploader.checkQueue.queue;
							var post;
							for(var k in q) {
								if(q[k].messageId == m[2]) {
									post = q[k];
									break;
								}
							}
							if(!post) {
								// check deferred queue too
								var q = uploader.checkQueue.queuePending;
								for(var k in q) {
									if(q[k].data.messageId == m[2]) {
										post = q[k].data;
										break;
									}
								}
							}
							if(post) {
								// dump post from check queue
								resp.writeHead(200, {
									'Content-Type': 'message/rfc977' // our made up MIME type; follows similarly to SMTP mail
								});
								resp.write(post.data);
							} else {
								resp.writeHead(404, {
									'Content-Type': 'text/plain'
								});
								resp.write('Specified post not found in queue');
							}
							resp.end();
						} else if(!path || path == '/') {
							// dump overall status
							resp.writeHead(200, {
								'Content-Type': 'text/plain'
							});
							writeState(resp);
							resp.end();
						} else {
							resp.writeHead(404, {
								'Content-Type': 'text/plain'
							});
							resp.end('Invalid URL');
						}
					});
				} else {
					server = require('net').createServer(function(conn) {
						writeState(conn);
						conn.end();
					});
				}
				server.listen(prg.port, prg.host, function() {
					var addr = server.address();
					if(addr.family == 'IPv6')
						addr = '[' + addr.address + ']:' + addr.port;
					else
						addr = addr.address + ':' + addr.port;
					Nyuu.log.info('Status ' + prg.type.toUpperCase() + ' server listening on ' + addr);
				});
				process.on('finished', function() {
					server.close();
				});
			break;
		}
	});
	
	displayCompleteMessage = function(err) {
		var msg = '';
		var time = Date.now() - startTime;
		if(err) {
			Nyuu.log.error(err);
			msg = 'Posted ' + uploader.articlesPosted + ' article(s)';
			var unchecked = uploader.articlesPosted - uploader.articlesChecked;
			if(unchecked)
				msg += ' (' + unchecked + ' unchecked)';
			msg += ' in ' + friendlyTime(time) + ' (' + friendlySize(uploader.bytesPosted/time*1000) + '/s)';
		} else {
			msg = 'Finished uploading ' + friendlySize(totalSize) + ' in ' + friendlyTime(time) + ' (' + friendlySize(totalSize/time*1000) + '/s)';
			
			if(errorCount)
				msg += ', with ' + errorCount + ' error(s) across ' + uploader.articleErrors + ' post(s)';
		}
		
		Nyuu.log.info(msg + '. Raw upload: ' + friendlySize(uploader.currentPostSpeed()*1000) + '/s');
	};
});
fuploader.on('processing_file', function(file) {
	Nyuu.log.info('Reading file ' + file.name + '...');
})
fuploader.once('read_complete', function() {
	Nyuu.log.info('All file(s) read...');
});
