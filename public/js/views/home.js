import $ from 'jquery';
import _ from 'lodash';

import ToolTip from '../components/tooltip';
import ProgressBar from '../components/progress-bar';
import {
  getUrl,
  getQueryParam,
} from '../helpers/utils';
import * as globals from '../helpers/globals';
import * as viewService from '../services/view';
import * as locationService from '../services/location';
import {
  VIEW_HOME,
} from '../constants/urls';

let viewWrapper;

// set the click event for about tips
function initAboutTipHandle() {
  let tooltip;
  $('.modules-wrapper', viewWrapper).on('click', '.tips', (e) => {
    if (tooltip) {
      tooltip.destroy();
      const currentTarget = tooltip.target;
      tooltip = null;
      if (currentTarget === e.currentTarget) {
        return;
      }
    }
    tooltip = new ToolTip(e.currentTarget, {
      left: '20%',
      className: 'module-about-tip',
    });
    tooltip.render();
  });
}

// get the module list view
function getView(url, selector) {
  const progress = new ProgressBar();
  const end = progress.render();
  return viewService.get(url, selector).then((data) => {
    end();
    return data;
  }).catch((err) => {
    end();
    throw err;
  });
}

// set the filter event
function initFilterHandle() {
  const setFilterSelected = (wrapper) => {
    const filterKeys = [
      getQueryParam('sort') || 'downloads.latest',
    ].sort();
    const filters = wrapper.find('a');
    _.forEach(filters, (item) => {
      const obj = $(item);
      const key = obj.data('key');
      if (_.sortedIndexOf(filterKeys, key) !== -1) {
        obj.addClass('selected');
      } else {
        obj.removeClass('selected');
      }
    });
  };
  let isShowFilter = false;
  const toggleFilter = () => {
    const wrapper = $('.filter-wrapper', viewWrapper);
    const filterBtn = $('.functions .filter', viewWrapper);
    wrapper.toggleClass('hidden');
    filterBtn.toggleClass('selected');
    isShowFilter = !isShowFilter;
    if (isShowFilter) {
      setFilterSelected(wrapper);
    }
  };

  // toggle filter
  $('.functions .filter', viewWrapper).click(toggleFilter);
  $('.filter-wrapper', viewWrapper).on('click', 'a', (e) => {
    const target = $(e.currentTarget);
    if (target.hasClass('selected')) {
      return;
    }
    const parent = target.closest('ul');
    parent.find('a.selected').removeClass('selected');
    target.addClass('selected');
    const type = parent.data('type');
    const params = {};
    params[type] = target.data('key');
    const url = getUrl(params);
    locationService.push(url);
    toggleFilter();
  });
}


const getMoreOptions = {
  isGettingMore: false,
  offset: 0,
  pageSize: 20,
};
// get more modules and append to the bottom
function getMore() {
  const {
    isGettingMore,
    offset,
    pageSize,
  } = getMoreOptions;
  if (isGettingMore) {
    return;
  }
  getMoreOptions.isGettingMore = true;
  const selector = '.modules-wrapper';
  const url = getUrl({
    offset: offset + pageSize,
  });
  const item = $(selector, viewWrapper);
  const loading = $(`
    <div class="loading tac">
      <i class="fa fa-spinner mright5" aria-hidden="true"></i>
      Getting more modules...
    </div>
  `).appendTo(item);
  getView(url, selector)
    .then((viewData) => {
      getMoreOptions.isGettingMore = false;
      getMoreOptions.offset += pageSize;
      loading.remove();
      item.append(viewData.content);
    }).catch((err) => {
      getMoreOptions.isGettingMore = false;
      loading.remove();
      console.error(err);
    });
}

// init the scroll event for get more modules
function initScrollHandle() {
  const doc = $(globals.get('document'));
  const windowHeight = $(globals.get('self')).height();
  const offset = 200;
  doc.on('scroll', _.debounce(() => {
    if (doc.scrollTop() + windowHeight + offset > $('body').height()) {
      getMore();
    }
  }));
}

// init the keyword handle
function initKeywordsHandle() {
  viewWrapper.on('click', '.keywords a', (e) => {
    const target = $(e.currentTarget);
    locationService.push(target.prop('href'));
    e.preventDefault();
  });
}

function initSearchHandle() {
  const inputFilter = '.search-component input';
  const doSearch = () => {
    const q = viewWrapper.find(inputFilter).val().trim();
    if (!q) {
      return;
    }
    locationService.push(getUrl({
      q,
    }, false));
  };
  viewWrapper.on('click', '.search-component .search', doSearch);
  viewWrapper.on('keyup', inputFilter, (e) => {
    if (e.keyCode === 0x0d) {
      doSearch();
    }
  });
}

locationService.on('change', (data) => {
  if (data.path !== VIEW_HOME) {
    return;
  }
  getMoreOptions.offset = 0;
  if (data.prevPath !== data.path) {
    viewWrapper = $('.home-view');
    initAboutTipHandle();
    initFilterHandle();
    initScrollHandle();
    initKeywordsHandle();
    initSearchHandle();
  } else {
    const selector = '.modules-wrapper';
    const item = $(selector, viewWrapper);
    getView(data.url, selector)
      .then(viewData => item.html(viewData.content))
      .catch(console.error);
  }
  // set search q
  const q = getQueryParam('q');
  if (q) {
    $('.search-component input', viewWrapper).val(q);
  }
});
