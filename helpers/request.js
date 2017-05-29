const request = require('superagent');
const _ = require('lodash');
const stringify = require('simple-stringify');

const plugin = {
  stats: true,
};

exports.timeout = 5 * 1000;

exports.disable = (category) => {
  plugin[category] = false;
};

exports.enable = (category) => {
  plugin[category] = true;
};

function httpStats(req) {
  const stats = {};
  const finished = _.once(() => {
    stats.use = Date.now() - stats.startedAt;
    delete stats.startedAt;
    if (stats.error) {
      console.error(stringify.json(stats));
    } else {
      console.info(stringify.json(stats));
    }
  });
  req.once('request', () => {
    /* eslint no-underscore-dangle:0 */
    const sendData = req._data;
    _.extend(stats, {
      host: req.host,
      path: req.req.path,
      method: req.method,
      startedAt: Date.now(),
    });
    // superagent-load-balancer will set the backendServer
    const backendServer = req.backendServer;
    if (backendServer) {
      _.extend(stats, _.pick(backendServer, ['ip', 'port']));
    }
    if (!_.isEmpty(sendData)) {
      stats.data = stringify.json(sendData);
    }
  });
  req.once('error', (err) => {
    stats.code = -1;
    stats.error = err.message;
    finished();
  });
  req.once('response', (res) => {
    stats.code = res.statusCode;
    finished();
  });
}

function defaultHandle(req) {
  req.timeout(exports.timeout);
  req.sortQuery();
  if (plugin.stats) {
    req.use(httpStats);
  }
}

_.forEach(['get', 'post', 'put', 'del', 'patch', 'delete'], (method) => {
  exports[method] = (...args) => {
    const req = request[method](...args);
    defaultHandle(req);
    return req;
  };
});
