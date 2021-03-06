const moment = require('moment');
const _ = require('lodash');
const Joi = require('joi');

const npmService = localRequire('services/npm');

exports.get = async (ctx) => {
  const options = Joi.validateThrow(ctx.query, {
    offset: Joi.number().integer().default(0),
    limit: Joi.number().integer().min(1).max(1000)
      .default(20),
  });
  const docs = await npmService.query({})
    .select('name')
    .skip(options.offset)
    .limit(options.limit);
  ctx.set('10m');
  ctx.body = _.map(docs, item => item.name);
};

exports.update = async (ctx) => {
  await npmService.update(ctx.params.name);
  ctx.body = null;
};

exports.updateDownloads = async (ctx) => {
  await npmService.updateDownloads(ctx.params.name);
  ctx.body = null;
};

exports.count = async (ctx) => {
  const options = ctx.query;
  const conditions = {};
  const getTime = (value) => {
    const date = moment()
      .add(parseInt(value, 10), 'day')
      .format('YYYY-MM-DD');
    return `${date}T00:00:00.000Z`;
  };
  if (options.created) {
    conditions.createdTime = {
      $gte: getTime(options.created),
    };
  }
  if (options.updated) {
    conditions['latest.time'] = {
      $gte: getTime(options.updated),
    };
  }
  if (options.author) {
    conditions['author.name'] = options.author;
  }
  if (options.keyword) {
    conditions.keywords = options.keyword;
  }
  if (options.q) {
    conditions.name = new RegExp(options.q);
  }
  const count = await npmService.count(conditions);
  ctx.setCache('10m');
  ctx.body = {
    count,
  };
};

exports.getDownloads = async (ctx) => {
  const formatStr = 'YYYY-MM-DD';
  const params = Joi.validateThrow(ctx.query, {
    begin: Joi.date().min(moment().add(-1, 'year').format(formatStr)),
    end: Joi.date().max(moment().format(formatStr))
      .default(moment().add(-1, 'day').format(formatStr)),
    interval: Joi.number().integer().min(1).default(1),
  });
  const name = ctx.params.name;
  const interval = params.interval;
  const begin = moment(params.begin).format(formatStr);
  const end = moment(params.end).format(formatStr);
  const data = await npmService.getDownloads(name, begin, end);
  if (interval > 1) {
    const result = [];
    let count = 0;
    const max = data.length;
    _.forEach(data, (item, index) => {
      count += item.count;
      if (index === max - 1 || (index + 1) % interval === 0) {
        result.push({
          count,
          date: item.date,
        });
        count = 0;
      }
    });
    ctx.body = result;
  } else {
    ctx.body = data;
  }
  ctx.setCache('60m', '10m');
};

exports.updatePeriodCounts = async (ctx) => {
  await npmService.updatePeriodCounts(ctx.params.name);
  ctx.body = null;
};

exports.getStatistics = async (ctx) => {
  const formatStr = 'YYYY-MM-DD';
  const params = Joi.validateThrow(ctx.query, {
    begin: Joi.date().min(moment().add(-1, 'year').format(formatStr)),
    end: Joi.date().max(moment().format(formatStr))
      .default(moment().add(-1, 'day').format(formatStr)),
    interval: Joi.number().integer().min(1).default(1),
  });
  const {
    begin,
    end,
    interval,
  } = params;
  const stats = await npmService.getStatistics(begin);
  const offset = moment(end).valueOf() - moment(begin).valueOf();
  const days = parseInt(offset / (24 * 3600 * 1000), 10);
  const data = [];
  let currentModulesCount = 0;
  for (let i = 0; i < days; i += 1) {
    const date = moment(begin).add(i, 'day').format(formatStr);
    const item = stats[date];
    if (item) {
      currentModulesCount = item.modules;
      data.push(_.extend({
        date,
      }, item));
    } else {
      data.push({
        date,
        created: 0,
        updated: 0,
        modules: currentModulesCount,
      });
    }
  }
  if (interval > 1) {
    const result = [];
    const max = data.length;
    let tmpResult = {
      created: 0,
      updated: 0,
    };
    _.forEach(data, (item, index) => {
      tmpResult.created += item.created;
      tmpResult.updated += item.updated;
      tmpResult.modules = item.modules;
      if (index === max - 1 || (index + 1) % interval === 0) {
        tmpResult.date = item.date;
        result.push(tmpResult);
        tmpResult = {
          created: 0,
          updated: 0,
        };
      }
    });
    ctx.body = result;
  } else {
    ctx.body = data;
  }
  ctx.setCache('60m', '10m');
};
