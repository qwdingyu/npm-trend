const _ = require('lodash');
const npmApis = require('npm-apis');
const moment = require('moment');

const Models = localRequire('models');
const errors = localRequire('helpers/errors');


/**
 * Update the counts of module
 * @param {String} name
 */
async function updatePeriodCounts(name) {
  const NPM = Models.get('Npm');
  const Count = Models.get('Count');
  const docs = await Count.find({
    name,
    date: {
      $gte: moment().add(-90, 'day').format('YYYY-MM-DD'),
    },
  });
  const dateDict = {
    latest: moment().add(-1, 'day').format('YYYY-MM-DD'),
    week: moment().add(-7, 'day').format('YYYY-MM-DD'),
    month: moment().add(-30, 'day').format('YYYY-MM-DD'),
    quarter: moment().add(-90, 'day').format('YYYY-MM-DD'),
  };
  const result = {};
  _.forEach(docs, (item) => {
    _.forEach(dateDict, (date, type) => {
      if (item.date >= date) {
        _.forEach(['downloads', 'dependeds'], (key) => {
          if (!result[key]) {
            result[key] = {};
          }
          if (!result[key][type]) {
            result[key][type] = 0;
          }
          result[key][type] += (item[key] || 0);
        });
      }
    });
  });
  const doc = await NPM.findOne({
    name,
  });
  _.forEach(['downloads', 'dependeds'], key => doc.set(key, result[key]));
  await doc.save();
}

/**
 * Update the information of module
 * @param {String} name
 */
exports.update = async (name) => {
  const basic = await npmApis.get(name);
  if (!basic || !basic.author) {
    throw errors.get(301);
  }
  let latestVersion;
  const versions = [];
  _.forEach(basic.time, (time, version) => {
    if (!latestVersion || latestVersion.time < time) {
      latestVersion = {
        version,
        time,
      };
    }
    versions.push({
      version,
      time,
    });
  });
  delete basic.time;
  delete basic.latest;
  basic.versions = _.sortBy(versions, item => item.time);
  basic.latest = latestVersion;
  const scores = await npmApis.getScore(name);
  // scores 有可能为空
  basic.scores = scores;
  const NPM = Models.get('Npm');
  const doc = await NPM.findOne({
    name,
  });
  if (!doc) {
    await new NPM(basic).save();
    return;
  }
  const updateKeys = [
    'keywords',
    'versions',
    'publishedTime',
    'latest',
    'scores',
  ];
  _.forEach(updateKeys, (key) => {
    const value = basic[key];
    doc.set(key, value);
  });
  await doc.save();
};

/**
 * Update the download information of module
 * @param {String} name The module's name
 */
exports.updateDownloads = async (name) => {
  const NPM = Models.get('Npm');
  const Count = Models.get('Count');
  const doc = await NPM.findOne({
    name,
  }, 'createdTime');
  if (!doc) {
    throw errors.get(301);
  }
  const downloadInfo = await Count.findOne({
    name,
    downloads: {
      $exists: true,
    },
  }).sort({
    date: -1,
  }).exec();
  const start = _.get(downloadInfo, 'date', doc.createdTime.substring(0, 10));
  const end = moment().add(-1, 'day').format('YYYY-MM-DD');
  if (start >= end) {
    return;
  }
  const downloadsList = await npmApis.getDownloads(name, start, end);
  await Promise.each(downloadsList, async (item) => {
    const downloads = item.downloads;
    if (!downloads) {
      return;
    }
    const date = item.day;
    const query = {
      name,
      date,
    };
    const countDoc = await Count.findOne(query);
    if (!countDoc) {
      await new Count({
        name,
        date,
        downloads,
      }).save();
      return;
    }
    countDoc.set('downloads', downloads);
    await countDoc.save();
  });
  await updatePeriodCounts(name);
};

/**
 * Update the module list
 * @param {any} names
 */
exports.updateModules = async (names) => {
  const NPM = Models.get('Npm');
  const Ignore = Models.get('Ignore');
  const ignoreDocs = await Ignore.find({}, 'name');
  const ignoreItems = _.map(ignoreDocs, item => item.name).sort();
  const doUpdate = async (name) => {
    if (_.sortedIndexOf(ignoreItems, name) !== -1) {
      return Promise.resolve();
    }
    const doc = await NPM.findOne({
      name,
    }, 'latest downloads');
    if (doc) {
      // 如果最近一周有更新版本 - 更新信息
      // 如果最近下载超过1K - 更新间隔为 7 天
      // 否则 14 天
      let updateInterval = 14;
      if (_.get(doc, 'downloads.latest') > 1000) {
        updateInterval = 7;
      }
      const oneDayMs = 24 * 3600 * 1000;
      const days = _.floor((Date.now() - moment(doc.latest.time).valueOf()) / oneDayMs);
      // 如果项目7天未更新，而且更新日期非更新区间，直接跳过
      if (days > 7 && (days % updateInterval) !== 0) {
        return Promise.resolve();
      }
    }
    return exports.update(name)
        .catch((err) => {
          console.error(`update ${name} fail, ${err.message}`);
          if (err.code === 301) {
            new Ignore({
              name,
            }).save().catch(console.error);
          }
        });
  };
  await Promise.map(names, doUpdate, {
    concurrency: 30,
  });
};

/**
 * Update the download of modules
 */
exports.updateModulesDownloads = async () => {
  const NPM = Models.get('Npm');
  const count = await NPM.count({});
  const offset = 10;
  const arr = _.range(0, _.ceil(count / offset));
  const update = async (start) => {
    const docs = await NPM.find({}, 'name')
      .skip(start)
      .limit(offset);
    const doDownloadUpdate = name => exports.updateDownloads(name)
      .then(() => console.info(`update ${name} downloads success`))
      .catch(err => console.error(`update ${name} downloads fail, ${err.message}`));
    return Promise.map(docs, item => doDownloadUpdate(item.name), {
      concurrency: 10,
    });
  };
  await Promise.each(arr, update);
};


/**
 * Update depened count of the module
 * @param {Object} data
 */
async function updateDependeds(data) {
  const {
    name,
    count,
  } = data;
  const NPM = Models.get('Npm');
  const Count = Models.get('Count');
  const today = moment().format('YYYY-MM-DD');
  const doc = await NPM.findOne({
    name,
  });
  if (!doc) {
    throw errors.get(301);
  }

  doc.set('dependedCount', count);
  await doc.save();

  const increase = count - _.get(doc, 'dependeds.latest', 0);
  // 如果增加量小于等于0，则跳过
  if (increase <= 0) {
    return;
  }
  const countDoc = await Count.findOne({
    name,
    date: today,
  });
  if (!countDoc) {
    await new Count({
      name,
      date: today,
      dependeds: increase,
    }).save();
  } else {
    countDoc.set('dependeds', increase);
    await countDoc.save();
  }
  await updatePeriodCounts(name);
}

/**
 * Update the depended count
 * @param {Array} list
 */
exports.updateMoudlesDependeds = async (list) => {
  await Promise.map(list, async (item) => {
    try {
      await updateDependeds(item);
    } catch (err) {
      console.error(`update ${item.name} dependeds fail, ${err.message}`);
    }
  }, {
    concurrency: 10,
  });
};

/**
 * Get the query for npm model
 * @param {Object} condition
 * @returns
 */
exports.query = (condition) => {
  const NPM = Models.get('Npm');
  return NPM.find(condition);
};
